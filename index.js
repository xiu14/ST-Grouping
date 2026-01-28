/**
 * ST-Grouping - SillyTavern 条目分组管理扩展
 * 
 * 整合功能：
 * 1. 提示词条目分组 (Prompt Entry Grouping) - 三连击创建分组
 * 2. 世界书分组管理 (WorldInfo Groups) - 长按菜单操作分组
 */

import { initPromptEntryGrouping, destroyPromptEntryGrouping } from './lib/prompt-entry-grouping-ui.js';
import { initWorldInfoGrouping } from './lib/worldinfo-grouping.js';

// 扩展名称
const extensionName = 'ST-Grouping';

// 初始化
jQuery(async () => {
    console.log(`[${extensionName}] 加载中...`);

    try {
        // 初始化提示词条目分组功能
        initPromptEntryGrouping();
        console.log(`[${extensionName}] 提示词条目分组功能已加载`);

        // 初始化世界书分组管理功能
        initWorldInfoGrouping();
        console.log(`[${extensionName}] 世界书分组管理功能已加载`);

        console.log(`[${extensionName}] 加载完成`);
    } catch (error) {
        console.error(`[${extensionName}] 加载失败:`, error);
    }
});

// 导出销毁函数供外部调用
window.destroySTGrouping = () => {
    destroyPromptEntryGrouping();
    console.log(`[${extensionName}] 已销毁`);
};
