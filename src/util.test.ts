import {expect} from 'chai';
import * as M from './util';

describe('util', function() {
    describe('cmpVersions()', callSuite(M.cmpVersions, [
        {it: "handles equal versions",
         i: ["1.0", "1.0"], o: 0},
        {it: "handles equal versions (but one is longer than the other)",
         i: ["1.0", "1.0.0"], o: 0},
        {it: "handles equal versions (but one is much longer than the other)",
         i: ["1.0", "1.0.0.0.0"], o: 0},
        {it: "handles a < b (major)",
         i: ["1.0", "2.0"], o: -1},
        {it: "handles a > b (major)",
         i: ["2.0", "1.0"], o: 1},
        {it: "handles a < b (minor)",
         i: ["1.0", "1.1"], o: -1},
        {it: "handles a > b (minor)",
         i: ["1.1", "1.0"], o: 1},
        {it: "handles a < b (major/minor)",
         i: ["1.3", "2.0"], o: -1},
        {it: "handles a > b (major/minor)",
         i: ["2.0", "1.3"], o: 1},
        {it: "handles a < b (major/minor, differing lengths)",
         i: ["1.3.3", "2.0"], o: -1},
        {it: "handles a > b (major/minor, differing lengths)",
         i: ["2.0", "1.3.3"], o: 1},
    ]));

    describe('urlToOpen()', callSuite(M.urlToOpen, [
        {
            it: 'passes http:// URLs through unscathed',
            i: ['http://foo.com'], o: 'http://foo.com'
        },
        {
            it: 'passes https:// URLs through unscathed',
            i: ['https://foo.com'], o: 'https://foo.com'
        },
        {
            it: 'passes complicated https:// URLs through unscathed',
            i: ['https://foo.com/testing?foo=bar#hashtag'],
            o: 'https://foo.com/testing?foo=bar#hashtag'
        },
        {
            it: 'passes about: URLs through unscathed',
            i: ['about:blank?foo=bar#hashtag'],
            o: 'about:blank?foo=bar#hashtag'
        },
        {
            it: 'transforms simple about:reader URLs',
            i: ['about:reader?url=http%3a%2f%2ffoo.com'],
            o: 'http://foo.com'
        },
        {
            it: 'transforms complicated about:reader URLs',
            i: ['about:reader?url=http%3a%2f%2ffoo.com'],
            o: 'http://foo.com'
        },
        {
            it: 'transforms about:reader URLs with query strings',
            i: ['about:reader?url=http%3a%2f%2ffoo.com%2Fdoc%3Ffoo%3Dbar'],
            o: 'http://foo.com/doc?foo=bar'
        },
        {
            it: 'transforms about:reader URLs with query strings and anchors',
            i: ['about:reader?url=http%3a%2f%2ffoo.com%2Fdoc%3Ffoo%3Dbar#pos'],
            o: 'http://foo.com/doc?foo=bar#pos'
        },
    ]));

    describe('urlsInTree()', callSuite(M.urlsInTree, [
        {
            it: "doesn't crash when provided with no nodes",
            i: [undefined], o: []
        },
        {
            it: 'extracts the URL from a leaf node',
            i: [{url: 'foo'}], o: ['foo']
        },
        {
            it: 'handles empty folders',
            i: [{children: []}], o: []
        },
        {
            it: 'extracts URLs from child folders',
            i: [{children: [
                {url: 'foo'},
                {url: 'bar'},
            ]}],
            o: ['foo', 'bar']
        },
        {
            it: 'handles empty nested folders',
            i: [{children: [
                {children: []},
                {url: 'bar'},
            ]}],
            o: ['bar']
        },
        {
            it: 'extracts URLs from nested folders',
            i: [{children: [
                {children: [
                    {url: 'foo'},
                ]},
                {url: 'bar'},
            ]}],
            o: ['foo', 'bar']
        },
        {
            it: 'extracts URLs across multiple levels',
            i: [{children: [
                {url: 'one'},
                {children: [
                    {url: 'foo'},
                ]},
                {url: 'bar'},
            ]}],
            o: ['one', 'foo', 'bar']
        },
        {
            it: 'extracts duplicate URLs',
            i: [{children: [
                {url: 'one'},
                {url: 'one'},
            ]}],
            o: ['one', 'one']
        },
        {
            it: 'extracts duplicate URLs across multiple folders',
            i: [{children: [
                {url: 'one'},
                {children: [
                    {url: 'foo'},
                    {children: [
                        {url: 'bar'},
                    ]},
                    {url: 'after'},
                ]},
                {type: 'bookmark', url: 'bar'},
            ]}],
            o: ['one', 'foo', 'bar', 'after', 'bar']
        },
    ]));

    describe('nonReentrant()', function() {
        let callCount = 0;
        let activeCalls = 0;
        let promise: Promise<any> | undefined;
        let res: () => void | undefined;
        let f: () => Promise<any> | undefined;
        let next: () => void | undefined;

        beforeEach(function() {
            f = M.nonReentrant(async function() {
                expect(activeCalls, 'internal pre').to.equal(0);
                ++activeCalls;
                await promise;
                expect(activeCalls, 'internal after await').to.equal(1);
                --activeCalls;
                ++callCount;
            });
            next = () => {
                let r = res;
                // Atomically switch /promise/ and /res/
                promise = new Promise(resolve => {res = resolve});
                // If we had an old promise active, resolve it
                if (r) r();
            };
            callCount = 0;
            next();
            expect(activeCalls, 'activeCalls pre').to.equal(0);
        });

        afterEach(function() {
            expect(activeCalls, 'activeCalls post').to.equal(0);
        });

        it('calls the async function immediately when first called',
           async function() {
               let end = f();
               next();
               await end;

               expect(callCount, 'callCount post').to.equal(1);
           });

        it('executes all calls that happen serially',
           async function() {
               let end1 = f();
               expect(activeCalls, 'activeCalls first').to.equal(1);
               next();
               await end1;
               expect(activeCalls, 'activeCalls first').to.equal(0);
               expect(callCount, 'callCount first').to.equal(1);

               let end2 = f();
               expect(activeCalls, 'activeCalls second').to.equal(1);
               next();
               await end2;
               expect(end1).to.not.equal(end2);
               expect(activeCalls, 'activeCalls second').to.equal(0);
               expect(callCount, 'callCount second').to.equal(2);

               let end3 = f();
               expect(activeCalls, 'activeCalls third').to.equal(1);
               next();
               await end3;
               expect(end2).to.not.equal(end3);
               expect(callCount, 'callCount third').to.equal(3);
           });

        it('delays a second call that happens during the first call',
           async function() {
               let end1 = f();
               expect(activeCalls, 'activeCalls both active').to.equal(1);

               let end2 = f();
               expect(end1).to.not.equal(end2);
               expect(activeCalls, 'activeCalls both active').to.equal(1);

               next();
               await end1;
               expect(activeCalls, 'activeCalls one active').to.equal(1);
               expect(callCount, 'callCount one active').to.equal(1);

               next();
               await end2;
               expect(callCount, 'callCount post').to.equal(2);
           });

        it('squashes together all calls that happen during the first call',
           async function() {
               let end1 = f();
               expect(activeCalls, 'activeCalls first active').to.equal(1);

               let end2 = f();
               let end3 = f();
               expect(end1).to.not.equal(end2);
               expect(end2).to.equal(end3);
               expect(activeCalls, 'activeCalls both active').to.equal(1);

               next();
               await end1;
               expect(activeCalls, 'activeCalls one active').to.equal(1);
               expect(callCount, 'callCount one active').to.equal(1);

               next();
               await end2;
               expect(callCount, 'callCount post').to.equal(2);
           });
    });

    describe('DeferQueue', function() {
        it('holds events until unplugged', function() {
            const dq = new M.DeferQueue();
            let count = 0;
            const fn = () => ++count;

            dq.push(fn);
            expect(count).to.equal(0);
            dq.push(fn);
            expect(count).to.equal(0);
        });

        it('fires queued events after it is unplugged', function() {
            const dq = new M.DeferQueue();
            let count = 0;
            const fn = () => ++count;

            dq.push(fn);
            expect(count).to.equal(0);
            dq.push(fn);
            expect(count).to.equal(0);

            dq.unplug();
            expect(count).to.equal(2);
        });

        it('fires events immediately after it is unplugged', function() {
            const dq = new M.DeferQueue();
            let count = 0;
            const fn = () => ++count;

            dq.unplug();
            dq.push(fn);
            expect(count).to.equal(1);
            dq.push(fn);
            expect(count).to.equal(2);
        });

        it('forwards arguments correctly to queued events', function() {
            const dq = new M.DeferQueue();
            let count = 0;
            const ain = 42;
            const bin = {a: 'b'};

            const fn = function(a: any, b: any) {
                ++count;
                expect(a).to.equal(ain);
                expect(b).to.equal(bin);
                expect(arguments.length).to.equal(2);
            };

            dq.push(fn, ain, bin);
            dq.unplug();
            expect(count).to.equal(1);
        });

        it('forwards arguments correctly to immediate events', function() {
            const dq = new M.DeferQueue();
            let count = 0;
            const ain = 42;
            const bin = {a: 'b'};

            const fn = function(a: any, b: any) {
                ++count;
                expect(a).to.equal(ain);
                expect(b).to.equal(bin);
                expect(arguments.length).to.equal(2);
            };

            dq.unplug();
            dq.push(fn, ain, bin);
            expect(count).to.equal(1);
        });
    });
});
