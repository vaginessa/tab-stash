<template>
  <section :class="{folder: true,
                    'action-container': true,
                    collapsed: is_collapsed}">
    <div class="panel-section-header">
      <div class="header">
        <span class="folder-name">Version {{v}}</span>
        <ButtonBox class="collapse-btnbox">
          <img :src="`icons/collapse-${is_collapsed ? 'closed' : 'open'}.svg`"
               :class="{action: true, collapse: true}"
               @click.prevent.stop="collapsed = ! is_collapsed">
        </ButtonBox>
      </div>
    </div>
    <ul class="contents">
      <slot/>
    </ul>
  </section>
</template>

<script lang="ts">
import ButtonBox from '../button-box.vue';
import {cmpVersions} from '../util';

export default {
    components: {ButtonBox},
    props: {v: String},
    inject: ['the_last_notified_version'],
    data: () => ({collapsed: undefined}),
    computed: {
        is_collapsed: function(this: any): boolean {
            if (this.collapsed !== undefined) return this.collapsed;
            return this.the_last_notified_version !== undefined
                && cmpVersions(this.v, this.the_last_notified_version) <= 0;
        },
    },
}
</script>

<style>
</style>
