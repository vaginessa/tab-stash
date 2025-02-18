import Options from './options-model';

import {urlToOpen} from './util';

export const STASH_FOLDER = 'Tab Stash';

// Interface used in place of browser.tabs.Tab, defining only the fields we care
// about for the purposes of stashing and restoring tabs.  Using this interface
// makes the API more permissive, because we can also take model objects in
// addition to official browser objects.
interface PartialTabInfo {
    id?: number,
    title?: string,
    url?: string,
}

export function getFolderNameISODate(n: string): string | null {
    let m = n.match(/saved-([-0-9:.T]+Z)/);
    return m ? m[1] : null;
}
export const genDefaultFolderName =
    (date: Date) => 'saved-' + date.toISOString();



export async function rootFolder() {
    return (await browser.bookmarks.search({title: STASH_FOLDER}))[0]
        || (await browser.bookmarks.create({
            title: STASH_FOLDER,
            type: 'folder',
        }));
}

export async function tabStashTree() {
    return (await browser.bookmarks.getSubTree((await rootFolder()).id))[0];
}

export async function mostRecentUnnamedFolderId() {
    let root = await rootFolder();
    let topmost = (await browser.bookmarks.getChildren(root.id))[0];
    if (topmost && topmost.type === 'folder'
        && getFolderNameISODate(topmost.title))
    {
        return topmost.id;
    }
    return undefined;
}

export function isURLStashable(urlstr: string): boolean {
    // NOTE: We don't actually check this here because it is filtered by our
    //callers; if we see a tab that is pinned at this point, we can safely
    //assume the user explicitly asked for it to be stashed.
    //
    // if (tab.pinned) return false;

    try {
        let url = new URL(urlstr);
        switch (url.protocol) {
            case 'about:':
                switch (url.pathname) {
                    // We carve out an exemption for about:reader URLs, since
                    // these are actual sites being viewed in reader mode.
                    case 'reader': return true;
                    default: return false;
                }
            case 'moz-extension:':
            case 'chrome:':
                return false;
        }
    } catch (e) {
        console.warn('Tab with unparseable URL:', urlstr);
        return false;
    }

    return true;
}

export async function stashTabsInWindow(
    windowId: number | undefined,
    options: {
        folderId?: string,
        close?: boolean
    }
): Promise<void> {
    // Stash either all tabs (if none are selected) or the selected tabs in the
    // window /windowId/ (or the current window, if /windowId/ is undefined).
    //
    // If /folderId/ is not specified, stashes into a new unnamed folder.
    //
    // If /close/ is true, closes/hides the stashed tabs according to the user's
    // preferences.
    if (windowId === undefined) windowId = browser.windows.WINDOW_ID_CURRENT;

    const tabs = await browser.tabs.query(
        {windowId, hidden: false, pinned: false});
    tabs.sort((a, b) => a.index - b.index);

    let selected = tabs.filter(t => t.highlighted);
    if (selected.length <= 1) selected = tabs;

    await stashTabs(selected, options);
}

export async function stashTabs(
    tabs: PartialTabInfo[],
    options: {
        folderId?: string,
        close?: boolean
    }
): Promise<void> {
    // Stashes the specified tabs into a bookmark folder.
    //
    // BIG WARNING: This function assumes that all passed-in tabs are in the
    // current window.  It WILL DO WEIRD THINGS if that's not the case.
    //
    // If /folderId/ is not specified, stashes into a new unnamed folder.
    //
    // If /close/ is true, closes/hides the stashed tabs according to the user's
    // preferences.

    const saved_tabs = await bookmarkTabs(options.folderId, tabs);

    if (options.close) await hideStashedTabs(saved_tabs);
}

// Hides tabs that we know are stashed.
export async function hideStashedTabs(tabs: PartialTabInfo[]): Promise<void> {
    let opts_p = Options.local();

    await refocusAwayFromTabs(tabs);
    const opts = await opts_p;

    const tids = <number[]>tabs.map(t => t.id).filter(id => id !== undefined);

    switch (opts.after_stashing_tab) {
    case 'hide_discard':
        await browser.tabs.hide(tids);
        await browser.tabs.discard(tids);
        break;
    case 'close':
        await browser.tabs.remove(tids);
        break;
    case 'hide':
    default:
        await browser.tabs.hide(tids);
        break;
    }
}

export async function closeTabs(tabs: PartialTabInfo[]): Promise<void> {
    const tids = <number[]>tabs.map(t => t.id).filter(id => id !== undefined);
    await refocusAwayFromTabs(tabs);
    await browser.tabs.remove(tids);
}

export async function refocusAwayFromTabs(
    tabs: PartialTabInfo[]
): Promise<void> {
    const all_tabs = await browser.tabs.query(
        {currentWindow: true, hidden: false});

    const front_tab_idx = all_tabs.findIndex(t => t.active);
    const front_tab = front_tab_idx == -1 ? undefined : all_tabs[front_tab_idx];
    if (front_tab && ! tabs.find(t => t.id === front_tab.id)) {
        // We are not closing the active tab.  Nothing to do.
        //
        // NOTE: If front_tab is undefined at this point, it's likely because
        // the user is looking at a pinned tab, since we are explicitly
        // filtering those out above.
        return;
    }

    if (tabs.length >= all_tabs.filter(t => ! t.pinned).length) {
        // If we are about to close all visible tabs in the window, we should
        // open a new tab so the window doesn't close.
        await browser.tabs.create({active: true});

    } else {
        // Otherwise we should make sure the currently-active tab isn't a tab we
        // are about to hide/discard.  The browser won't let us hide the active
        // tab, so we'll have to activate a different tab first.
        //
        // We do this search a little strangely--first looking only at tabs
        // AFTER the tabs we're stashing, followed by looking only at tabs
        // BEFORE the tabs we're stashing, to mimic the browser's behavior when
        // closing the front tab.

        let candidates = all_tabs.slice(front_tab_idx + 1);
        let focus_tab = candidates.find(
            t => t.id !== undefined && ! tabs.find(u => t.id === u.id));
        if (! focus_tab) {
            candidates = all_tabs.slice(0, front_tab_idx).reverse();
            focus_tab = candidates.find(
                t => t.id !== undefined && ! tabs.find(u => t.id === u.id));
        }

        // We should always have a /focus_tab/ at this point, but if we don't,
        // it's better to fail gracefully by doing nothing.
        console.assert(focus_tab);
        // We filter out tabs with undefined IDs above #undef
        if (focus_tab) await browser.tabs.update(focus_tab.id!, {active: true});
    }
}

// Determine if the specified tab has anything "useful" in it (where "useful" is
// defined as neither the new-tab page nor the user's home page).  Returns the
// tab itself if not, otherwise returns undefined.
export async function isNewTabURL(url: string | undefined): Promise<boolean> {
    let newtab_url_p = browser.browserSettings.newTabPageOverride.get({});
    let home_url_p = browser.browserSettings.newTabPageOverride.get({});
    let newtab_url = (await newtab_url_p).value;
    let home_url = (await home_url_p).value;

    switch (url) {
        case newtab_url:
        case home_url:
        case 'about:blank':
        case 'about:newtab':
            return true;
        default:
            return false;
    }
}

async function bookmarkTabs(
    folderId: string | undefined,
    all_tabs: PartialTabInfo[]
): Promise<PartialTabInfo[]> {
    // Figure out which of the tabs to save.  We ignore tabs with unparseable
    // URLs or which look like extensions and internal browser things.
    //
    // We filter out all tabs without URLs below. #cast
    const tabs = <(PartialTabInfo & {url: string})[]>
        all_tabs.filter(t => t.url && isURLStashable(t.url));

    // If there are no tabs to save, early-exit here so we don't unnecessarily
    // create bookmark folders we don't need.
    if (tabs.length == 0) return tabs;

    // Find or create the root of the stash.
    let root = await rootFolder();

    // Keep track of which tabs to actually save (we filter below based on what
    // we already have), and where in the folder to save them (we want to
    // append).
    let tabs_to_actually_save = tabs;
    let index = 0;

    if (folderId === undefined) {
        // Create a new folder, if it wasn't specified.
        let folder = await browser.bookmarks.create({
            parentId: root.id,
            title: genDefaultFolderName(new Date()),
            type: 'folder',
            index: 0, // Newest folders should show up on top
        });
        folderId = folder.id;

        // When saving to this folder, we want to save all tabs we previously
        // identified as "save-worthy", and we want to insert them at the
        // beginning of the folder.  So, no changes to /tabs_to_actually_save/
        // or /index/ here.

    } else {
        // If we're adding to an existing folder, skip bookmarks which already
        // exist in that folder.  These won't be picked up by
        // gcDuplicateBookmarks() below since we purposefully exclude the folder
        // we are adding to/just created (see below for why).
        //
        // Note, however, that these tabs are still considered "saved" for the
        // purposes of this function, because the already appear in the folder.
        // So it's okay for callers to assume that we saved them--that's why we
        // use a separate /tabs_to_actually_save/ array here.
        let existing_bms = (await browser.bookmarks.getChildren(folderId))
            .map(bm => bm.url);

        tabs_to_actually_save = tabs_to_actually_save.filter(
            tab => ! existing_bms.includes(tab.url));

        // Append new bookmarks to the end of the folder.
        index = existing_bms.length;
    }

    // Now save each tab as a bookmark.
    //
    // Unfortunately, Firefox doesn't have an API to save multiple bookmarks in
    // a single transaction, so to avoid this being unbearably slow, we do this
    // in two passes--create a bunch of empty bookmarks in parallel, and then
    // fill them in with the right values (again in parallel).
    let ps = [];
    let created_bm_ids = new Set();
    for (let _tab of tabs_to_actually_save) {
        ps.push(browser.bookmarks.create({
            parentId: folderId,
            title: 'Stashing...',
            // We provide a unique URL for each in-progress stash to avoid
            // problems with Firefox Sync erroneously de-duplicating bookmarks
            // with the same URL while the stash is in progress.  See issue #8
            // and Firefox bug 1549648.
            url: `about:blank#stashing-${folderId}-${index}`,
            index,
        }));
        ++index;
    }
    for (let p of ps) created_bm_ids.add((await p).id);
    ps = [];

    // We now read the folder back to determine the order of the created
    // bookmarks, so we can fill each of them in in the correct order.
    //
    // We know that the bookmark node returned from getSubTree() has children
    // because it's a folder we created or identified earlier, and we were able
    // to successfully create child bookmarks under it above.  #undef
    let child_bms = (await browser.bookmarks.getSubTree(folderId))[0].children!;

    // Now fill everything in.
    let tab_index = 0;
    for (let bm of child_bms) {
        if (! created_bm_ids.has(bm.id)) continue;
        created_bm_ids.delete(bm.id);
        ps.push(browser.bookmarks.update(bm.id, {
            // #undef typedef is wrong; title/url are both optional
            title: tabs_to_actually_save[tab_index].title!,
            url: urlToOpen(tabs_to_actually_save[tab_index].url!),
        }));
        ++tab_index;
    }
    for (let p of ps) await p;

    // In the background, remove any duplicate bookmarks in other tab-stash
    // folders.  gcDuplicateBookmarks() prefers to keep bookmarks that appear
    // earlier in the tree over those that appear later.  We purposefully
    // exclude the folder we just created/added to, since the user expressed a
    // preference to have open tabs saved to this folder (and not other
    // folders).  So it's better to remove from OTHER folders even if they
    // appear first.
    //
    // We also avoid touching URLs that weren't explicitly saved, since that may
    // be surprising to users (there are corner cases where we might have
    // duplicates if the user decides to rename a named folder to have a
    // default/temporary name once again).
    gcDuplicateBookmarks(root.id, new Set([folderId]),
                         new Set(tabs.map(t => t.url))).catch(console.log);

    return tabs;
}

export async function gcDuplicateBookmarks(
    root_id: string,
    ignore_folder_ids: Set<string>,
    urls_to_check: Set<string>
): Promise<void> {
    let folders = (await browser.bookmarks.getSubTree(root_id))[0].children
        || [];

    // We want to preserve/ignore duplicates in folders which are ignored
    // (/ignored_folder_ids/), and folders which were explicitly-named by the
    // user (i.e. folders which do not have a "default" name of the date/time at
    // which they were created).  These are "preserved folders".
    let should_preserve_folder = (f: browser.bookmarks.BookmarkTreeNode) =>
        (ignore_folder_ids && ignore_folder_ids.has(f.id))
        || ! getFolderNameISODate(f.title);

    // We do two passes--first, we look at preserved folders and add all their
    // URLs to the /seen_urls/ set.  Then, we look at all the NON-prserved
    // folders and remove URLs that we've already seen.
    //
    // The intention here is that by default, we remove duplicates that show up
    // later in the bookmarks tree, EXCEPT for preserved folders--we prefer to
    // keep duplicates in those folders instead, and we want to REMOVE
    // duplicates in non-preserved folders even if they show up earlier in the
    // tree.

    // Pass 1 - Note which bookmarks exist in preserved folders.
    let seen_urls = new Set();
    for (let f of folders) {
        if (! f.children) continue;
        if (! should_preserve_folder(f)) continue;

        for (let b of f.children) if (b.url) seen_urls.add(b.url);
    }

    // Pass 2 - Remove bookmarks from non-preserved folders.
    let ps = [];
    for (let f of folders) {
        if (! f.children) continue;
        if (should_preserve_folder(f)) continue;

        // Remove any bookmarks which we have already seen.  Keep track of how
        // many we removed so we know when the folder is empty and can itself be
        // removed.
        let rmcount = 0;
        for (let b of f.children) {
            if (! b.url) continue;

            if (urls_to_check.has(b.url) && seen_urls.has(b.url)) {
                ps.push(browser.bookmarks.remove(b.id));
                ++rmcount;
            } else {
                seen_urls.add(b.url);
            }
        }

        if (rmcount == f.children.length) {
            // This folder should be empty.  Remove it (using regular remove()
            // so if it's not actually empty, the remove will fail).
            //
            // First, however, wait for outstanding removes so we don't try to
            // remove a folder that has stuff that's still in the process of
            // being removed.
            for (let p of ps) try {await p} catch(e) {console.log(e)};
            ps = [];

            ps.push(browser.bookmarks.remove(f.id));
        }
    }

    for (let p of ps) try {await p} catch(e) {console.log(e)};
}

export async function restoreTabs(
    urls: string[],
    options: {background?: boolean}
): Promise<browser.tabs.Tab[]> {
    // Remove duplicate URLs so we only try to restore each URL once.
    urls = Array.from(new Set(urls));

    // First collect some info from the browser; done in parallel to reduce
    // latency.

    // We also want to know what tabs were recently closed, so we can
    // restore/un-hide tabs as appropriate.
    const closed_tabs_p = browser.sessions.getRecentlyClosed();

    // We also need to know which window to restore tabs to, and what tabs are
    // presently open in that window.
    const win_p = browser.windows.getCurrent({populate: true});

    const closed_tabs = await closed_tabs_p;
    const win = await win_p;
    const winid = win.id!; // #undef ASSUME we aren't in a devtools window
    const wintabs = win.tabs!; // #undef because {populate: true} returns tabs

    // We want to know which tab the user is currently looking at so we can
    // close it if it's just the new-tab page, and because if we restore any
    // closed tabs, the browser will re-focus (and we may want to shift the
    // focus back if we've been asked to restore in the background).
    const curtab = wintabs.filter(t => t.active)[0];

    // We can restore a tab in one of four(!) ways:
    //
    // 1. Do nothing (because the tab is already open).
    // 2. Un-hide() it, if it was previously hidden and is still open.
    // 3. Re-open a recently-closed tab with the same URL.
    // 4. Open a new tab.
    //
    // Let's figure out which strategy to use for each tab, and kick it off.
    let ps: Promise<browser.tabs.Tab>[] = [];
    let index = wintabs.length;
    for (const url of urls) {
        const open = wintabs.find(tab => (tab.url === url
                                          || urlToOpen(tab.url!) === url));
        if (open && open.id !== undefined) {
            // Tab is already open.  If it was hidden, un-hide it and move it to
            // the right location in the tab bar.
            if (open.hidden) {
                ps.push(async function(open) {
                    await browser.tabs.show([open.id!]);
                    await browser.tabs.move(
                        open.id!, {windowId: winid, index});
                    return open;
                }(open));
                ++index;
            }
            continue;
        }

        const closed = closed_tabs.find(
            sess => (sess.tab && (sess.tab.url === url
                                  || urlToOpen(sess.tab.url!) === url)
                     || false));
        if (closed) {
            const ct = closed.tab!;

            // Tab was recently-closed.  Re-open it, and move it to the right
            // location in the tab bar.
            ps.push(async function(ct) {
                // #undef We filtered out non-tab sessions above, and we know
                // that /ct/ is a session-flavored Tab.
                const t = (await browser.sessions.restore(ct.sessionId!)).tab!;
                // #undef The restored tab is a normal (non-devtools) tab
                await browser.tabs.move(t.id!, {windowId: winid, index});
                return t;
            }(ct));
            ++index;
            continue;
        }

        ps.push(browser.tabs.create({
            active: false, url: urlToOpen(url), index}));
        ++index;
    }

    // NOTE: Can't do this with .map() since await doesn't work in a nested
    // function context. :/
    let tabs: browser.tabs.Tab[] = [];
    for (let p of ps) tabs.push(await p);

    if (! options || ! options.background) {
        // Special case: If we were asked to open only one tab AND that tab is
        // already open, just switch to it.
        if (urls.length == 1 && tabs.length == 0) {
            const open_tab = wintabs.find(t => t.url === urls[0]
                                          || urlToOpen(t.url!) === urls[0]);
            // #undef Since we opened no tabs, yet we were asked to open one
            // URL, the tab must be open and therefore listed in /wintabs/.
            await browser.tabs.update(open_tab!.id, {active: true});
        }

        // Special case: If only one tab was restored, switch to it.  (This is
        // different from the special case above, in which NO tabs are
        // restored.)
        if (tabs.length == 1) {
            const tab = tabs[0];
            // #undef Tabs we opened must always have IDs (they're not devtools)
            await browser.tabs.update(tab.id!, {active: true});
        }

        // Finally, if we opened at least one tab, AND the current tab is
        // looking at the new-tab page, close the current tab in the background.
        if (tabs.length > 0 && await isNewTabURL(curtab.url)
            && curtab.status === 'complete')
        {
            // #undef devtools tabs don't have URLs and won't fall in here
            browser.tabs.remove([curtab.id!]).catch(console.log);
        }

    } else {
        // Caller has indicated they don't want the tab focus disturbed.
        // Unfortunately, if we restored any sessions, that WILL disturb the
        // focus, so we need to re-focus on the previously-active tab.
        //
        // #undef If the user is looking at a devtools tab, we can't switch back
        await browser.tabs.update(curtab.id!, {active: true});
    }

    return tabs;
}
