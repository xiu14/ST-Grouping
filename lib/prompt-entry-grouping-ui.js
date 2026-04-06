// ST-Grouping - 提示词条目分组 UI 逻辑
// 原始来源: prompt-entry-grouping/lib/entry-grouping-ui.js
// 包含所有关键的防抖、事件拦截、避免循环触发的逻辑

import { debounce, getJQuery, getSillyTavernContext, ensureViewportCssVars } from './utils.js';
import { getAllPresetGroupings, addPresetGrouping, updatePresetGrouping, removePresetGrouping, getLoadedPresetName } from './prompt-entry-grouping.js';
import { CommonStyles } from './common-styles.js';
import { addToggleAllButtonToGroupHeader, toggleAllEntriesInGroup } from './toggle-button.js';

// ==================== 状态变量 ====================

// 临时标记状态（用于三连击创建分组）
const tempMarks = { start: null, end: null };

// MutationObserver 实例
let listObserver = null;
let panelObserver = null;
let themeObserver = null;

// 定时器和标志位
let applyGroupingTimer = null;
let isApplyingGrouping = false;  // 🔑 关键：防止循环触发
let applyGroupingQueued = false;

// 观察的节点引用
let observedListNode = null;
let observedPanelNode = null;

// 签名缓存（用于避免重复渲染）
let lastAppliedGroupingSignature = null;
let lastAppliedGroupingPreset = null;
let lastAppliedGroupingListNode = null;

// 功能开关
let entryGroupingEnabled = true;

// PromptManager Hook 状态
let promptManagerHookInstalled = false;

// 主题刷新定时器
let themeRefreshTimeouts = [];

// 零解析重试
let zeroResolvedRetryPreset = null;
let zeroResolvedRetryCount = 0;

// 分组展开状态
const groupExpandStates = new Map();

// 事件取消订阅
let settingsUpdatedUnsubscribe = null;

// ==================== 签名计算（避免重复渲染） ====================

/**
 * 计算分组配置的唯一签名
 * 🔑 关键技术：通过签名比对，避免相同配置下重复渲染，提升性能
 */
function computeGroupingSignature(presetName, orderedIdentifiers, groupings) {
    const listKey = orderedIdentifiers.join('\u001f');
    const groupingKey = groupings
        .map((g) => [
            g?.name ?? '',
            g?.startIdentifier ?? '',
            g?.endIdentifier ?? '',
            g?.mode ?? '',
            g?.unresolved ? '1' : '0',
            typeof g?.legacyStartIndex === 'number' ? String(g.legacyStartIndex) : '',
            typeof g?.legacyEndIndex === 'number' ? String(g.legacyEndIndex) : '',
        ].join('\u001e'))
        .join('\u001d');

    return `${presetName}\u001c${listKey}\u001c${groupingKey}`;
}

// ==================== DOM 查找辅助函数 ====================

function findListContainer() {
    const $ = getJQuery();
    let container = $('#openai_prompt_manager_list');
    if (!container.length) container = $('[id$="prompt_manager_list"]').first();
    if (!container.length) container = $('ul[id*="prompt_manager"]').first();
    return container;
}

function findPanelContainer() {
    const listContainer = findListContainer();
    return listContainer.closest('.range-block');
}

function findPromptManagerRoot() {
    const $ = getJQuery();
    const listContainer = findListContainer();

    if (listContainer.length) {
        const rooted = listContainer.closest('[id$="_prompt_manager"], [id*="_prompt_manager"]');
        if (rooted.length) return rooted.first();
    }

    let root = $('#completion_prompt_manager');
    if (!root.length) root = $('[id$="_prompt_manager"]').first();
    return root;
}

function isVisibleElement(element) {
    if (!(element instanceof Element) || !element.isConnected) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return element.getClientRects().length > 0;
}

function isPromptManagerVisible() {
    const listContainer = findListContainer();
    if (!listContainer.length) return false;

    const root = findPromptManagerRoot();
    const rootElement = root[0];
    const listElement = listContainer[0];

    if (rootElement?.closest('.closedDrawer,[style*="display: none"]')) return false;
    if (!isVisibleElement(rootElement || listElement)) return false;
    return isVisibleElement(listElement);
}

function getOrderedIdentifiersFromList() {
    const listContainer = findListContainer();
    if (!listContainer.length) return [];
    return listContainer
        .find('li[data-pm-identifier]')
        .toArray()
        .map((el) => el.getAttribute('data-pm-identifier'))
        .filter(Boolean);
}

function getGroupedIdentifierSet(presetName, orderedIdentifiers) {
    const groupings = getAllPresetGroupings(presetName, orderedIdentifiers);
    const grouped = new Set();

    for (const g of groupings) {
        if (g?.unresolved) continue;
        if (typeof g.startIdentifier !== 'string' || typeof g.endIdentifier !== 'string') continue;
        const startIndex = orderedIdentifiers.indexOf(g.startIdentifier);
        const endIndex = orderedIdentifiers.indexOf(g.endIdentifier);
        if (startIndex === -1 || endIndex === -1) continue;

        const start = Math.min(startIndex, endIndex);
        const end = Math.max(startIndex, endIndex);
        for (let i = start; i <= end; i++) {
            const id = orderedIdentifiers[i];
            if (id) grouped.add(id);
        }
    }

    return grouped;
}

// ==================== 分组 UI 管理 ====================

function hasGroupingUi(listContainer) {
    return !!listContainer.find('.peg-group-header').length;
}

function cleanupGroupingUi(listContainer) {
    listContainer.find('.peg-group-wrapper').contents().unwrap();
    listContainer.find('.peg-group-header').remove();
}

function resetTempMarks() {
    tempMarks.start = null;
    tempMarks.end = null;
}

// ==================== 主题变量应用 ====================

function applyEntryGroupingThemeVars() {
    const panelContainer = findPanelContainer();
    if (!panelContainer.length) return;

    const vars = CommonStyles.getVars();
    panelContainer.addClass('peg-root');
    panelContainer[0].style.setProperty('--peg-bg', vars.bgColor);
    panelContainer[0].style.setProperty('--peg-border', vars.borderColor);
    panelContainer[0].style.setProperty('--peg-section-bg', vars.sectionBg);
    panelContainer[0].style.setProperty('--peg-text', vars.textColor);
    panelContainer[0].style.setProperty('--peg-tip', vars.tipColor);
    panelContainer[0].style.setProperty('--peg-danger', vars.dangerColor);
}

// ==================== 🔑 防抖和队列机制 ====================

/**
 * 队列化应用分组
 * 🔑 关键技术：使用 Promise.resolve() 将多次调用合并到一个微任务
 */
function queueApplyGrouping() {
    if (!entryGroupingEnabled) return;
    if (!isPromptManagerVisible()) return;
    if (applyGroupingQueued) return;
    applyGroupingQueued = true;

    Promise.resolve().then(() => {
        applyGroupingQueued = false;

        const currentList = findListContainer();
        if (!listObserver || (currentList.length && observedListNode !== currentList[0])) {
            setupListObserver();
        }
        applyGroupingToList();
    });
}

/**
 * 调度分组应用
 * 🔑 关键技术：防抖延迟，避免频繁触发
 * @param {number} delay - 延迟毫秒数，0 表示立即执行（通过微任务）
 */
function scheduleApplyGrouping(delay = 150) {
    if (!entryGroupingEnabled) return;
    if (!isPromptManagerVisible()) {
        if (applyGroupingTimer) {
            clearTimeout(applyGroupingTimer);
            applyGroupingTimer = null;
        }
        return;
    }
    if (applyGroupingTimer) clearTimeout(applyGroupingTimer);

    if (delay <= 0) {
        applyGroupingTimer = null;
        queueApplyGrouping();
        return;
    }

    applyGroupingTimer = setTimeout(() => {
        const currentList = findListContainer();
        if (!listObserver || (currentList.length && observedListNode !== currentList[0])) {
            setupListObserver();
        }
        applyGroupingToList();
        applyGroupingTimer = null;
    }, delay);
}

// ==================== 🔑 智能 Mutation 过滤 ====================

/**
 * 检查节点是否包含分组 UI
 * 🔑 关键：跳过自身 UI 节点的变化，避免循环触发
 */
function nodeHasGroupingUi(node) {
    if (!node || node.nodeType !== 1) return false;
    const el = node;
    if (
        el.classList?.contains('peg-group-wrapper')
        || el.classList?.contains('peg-group-header')
    ) {
        return true;
    }
    if (typeof el.querySelector !== 'function') return false;
    return !!el.querySelector('.peg-group-wrapper,.peg-group-header');
}

/**
 * 检查节点是否包含 Prompt Manager 条目
 */
function nodeHasPromptManagerItems(node) {
    if (!node || node.nodeType !== 1) return false;
    const el = node;
    if (el.tagName === 'LI' && el.hasAttribute('data-pm-identifier')) return true;
    if (
        el.classList?.contains('peg-group-wrapper')
        || el.classList?.contains('peg-group-header')
    ) {
        return true;
    }
    return typeof el.querySelector === 'function' && !!el.querySelector('li[data-pm-identifier]');
}

/**
 * 判断 Mutation 是否相关
 * 🔑 关键技术：只关心包含 prompt-manager 条目的变化
 */
function isRelevantListMutation(mutation) {
    if (mutation.type === 'childList') {
        return Array.from(mutation.addedNodes).some(nodeHasPromptManagerItems)
            || Array.from(mutation.removedNodes).some(nodeHasPromptManagerItems);
    }

    // 也监听 identifier 属性变化
    if (mutation.type === 'attributes') {
        return mutation.attributeName === 'data-pm-identifier'
            && mutation.target?.nodeType === 1
            && mutation.target?.tagName === 'LI';
    }

    return false;
}

function nodeHasPromptManagerList(node) {
    if (!node || node.nodeType !== 1) return false;
    const el = node;

    if (el.classList?.contains('peg-group-header') || el.classList?.contains('peg-group-wrapper')) return false;

    const id = el.id || '';
    if (id === 'openai_prompt_manager_list') return true;
    if (id.endsWith('prompt_manager_list')) return true;
    if (id.includes('prompt_manager') && el.tagName === 'UL') return true;

    if (typeof el.querySelector !== 'function') return false;
    return !!el.querySelector('#openai_prompt_manager_list,[id$="prompt_manager_list"],ul[id*="prompt_manager"]');
}

function isRelevantPanelMutation(mutation) {
    if (mutation.type !== 'childList') return false;
    return Array.from(mutation.addedNodes).some(nodeHasPromptManagerList)
        || Array.from(mutation.removedNodes).some(nodeHasPromptManagerList);
}

// ==================== Observer 设置 ====================

function setupListObserver() {
    if (listObserver) {
        listObserver.disconnect();
        listObserver = null;
        observedListNode = null;
    }

    const listContainer = findListContainer();
    if (!listContainer.length) {
        setTimeout(() => setupListObserver(), 1000);
        return;
    }

    listObserver = new MutationObserver((mutations) => {
        // 🔑 关键：如果正在应用分组，忽略变化（避免递归触发）
        if (isApplyingGrouping) return;

        if (mutations.some(isRelevantListMutation)) {
            const touchesGroupingUi = mutations.some((mutation) => {
                if (mutation.type !== 'childList') return false;
                return Array.from(mutation.removedNodes).some(nodeHasGroupingUi)
                    || Array.from(mutation.addedNodes).some(nodeHasGroupingUi);
            });

            if (touchesGroupingUi) {
                scheduleApplyGrouping(0);
                setTimeout(() => scheduleApplyGrouping(0), 150);
            } else {
                scheduleApplyGrouping(150);
            }
        }
    });

    listObserver.observe(listContainer[0], {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['data-pm-identifier'],
    });
    observedListNode = listContainer[0];
}

function setupPanelObserver() {
    const panelContainer = findPromptManagerRoot();
    const panelNode = panelContainer[0];
    if (!panelNode) {
        setTimeout(() => setupPanelObserver(), 1000);
        return;
    }
    if (panelObserver && observedPanelNode === panelNode) return;

    if (panelObserver) {
        panelObserver.disconnect();
        panelObserver = null;
        observedPanelNode = null;
    }

    panelObserver = new MutationObserver((mutations) => {
        if (isApplyingGrouping) return;
        if (mutations.some(isRelevantPanelMutation)) {
            scheduleApplyGrouping(0);
            setTimeout(() => scheduleApplyGrouping(0), 150);
        }
    });

    panelObserver.observe(panelNode, { childList: true, subtree: true });
    observedPanelNode = panelNode;
}

// ==================== 主题变化监听 ====================

function clearThemeRefreshTimeouts() {
    if (!themeRefreshTimeouts.length) return;
    themeRefreshTimeouts.forEach((t) => clearTimeout(t));
    themeRefreshTimeouts = [];
}

function triggerGroupingRefreshBurst() {
    if (!entryGroupingEnabled) return;

    clearThemeRefreshTimeouts();
    scheduleApplyGrouping(0);
    [120, 420, 900, 1800].forEach((delay) => {
        themeRefreshTimeouts.push(setTimeout(() => scheduleApplyGrouping(0), delay));
    });
}

function teardownThemeReapplyListener() {
    clearThemeRefreshTimeouts();

    try {
        if (themeObserver) {
            themeObserver.disconnect();
            themeObserver = null;
        }
    } catch { }

    try {
        settingsUpdatedUnsubscribe?.();
    } catch { }
    settingsUpdatedUnsubscribe = null;
}

function setupThemeReapplyListener() {
    teardownThemeReapplyListener();

    try {
        const context = getSillyTavernContext();
        const eventSource = context?.eventSource;
        const settingsEvent = context?.eventTypes?.SETTINGS_UPDATED;
        if (eventSource?.on && settingsEvent) {
            const handler = () => triggerGroupingRefreshBurst();
            eventSource.on(settingsEvent, handler);
            settingsUpdatedUnsubscribe = () => {
                try {
                    eventSource.removeListener?.(settingsEvent, handler);
                } catch { }
            };
        }
    } catch { }

    const root = document.documentElement;
    const body = document.body;
    if (!root || !body) return;

    const debounced = debounce(() => triggerGroupingRefreshBurst(), 200);
    themeObserver = new MutationObserver((mutations) => {
        if (!entryGroupingEnabled) return;
        if (isApplyingGrouping) return;
        if (mutations.some((m) => m.type === 'attributes' && (m.attributeName === 'style' || m.attributeName === 'class'))) {
            debounced();
        }
    });

    themeObserver.observe(root, { attributes: true, attributeFilter: ['style', 'class'] });
    themeObserver.observe(body, { attributes: true, attributeFilter: ['style', 'class'] });
}

// ==================== PromptManager Hook ====================

async function installPromptManagerHook() {
    if (promptManagerHookInstalled) return;
    promptManagerHookInstalled = true;

    try {
        const mod = await import('/scripts/PromptManager.js');
        const PromptManager = mod?.PromptManager;
        if (!PromptManager?.prototype) return;

        if (PromptManager.prototype.__pegHooked) return;

        const originalMakeDraggable = PromptManager.prototype.makeDraggable;
        if (typeof originalMakeDraggable !== 'function') return;

        PromptManager.prototype.makeDraggable = function (...args) {
            const result = originalMakeDraggable.apply(this, args);
            try {
                scheduleApplyGrouping(0);
            } catch { }
            return result;
        };

        PromptManager.prototype.__pegHooked = true;
    } catch (error) {
        console.warn('[ST-Grouping] failed to hook PromptManager:', error);
    }
}

// ==================== Toggle 重新应用监听 ====================

function setupToggleReapplyListener() {
    const $ = getJQuery();
    $(document)
        .off('click.peg-toggle')
        .on('click.peg-toggle', '.prompt-manager-toggle-action', () => {
            scheduleApplyGrouping(0);
            setTimeout(() => scheduleApplyGrouping(0), 200);
        });
}

// ==================== 🔑 核心：应用分组到列表 ====================

function applyGroupingToList() {
    if (!entryGroupingEnabled) return;
    if (!isPromptManagerVisible()) return;
    const $ = getJQuery();
    const presetName = getLoadedPresetName();
    if (!presetName) return;

    const listContainer = findListContainer();
    if (!listContainer.length) return;

    // 🔑 关键：设置标志位，防止 MutationObserver 递归触发
    isApplyingGrouping = true;

    try {
        applyEntryGroupingThemeVars();

        const groupingUiExists = hasGroupingUi(listContainer);

        const preItems = listContainer.find('li[data-pm-identifier]').toArray();
        if (preItems.length === 0) {
            return;
        }

        const preOrderedIdentifiers = preItems
            .map((el) => el.getAttribute('data-pm-identifier'))
            .filter(Boolean);
        const preUnique = new Set(preOrderedIdentifiers);
        if (preUnique.size !== preOrderedIdentifiers.length) {
            console.warn('[ST-Grouping] duplicate data-pm-identifier detected; skipping grouping.');
            bindTripleClickEvents();
            return;
        }

        const preGroupings = getAllPresetGroupings(presetName, preOrderedIdentifiers);
        const signature = computeGroupingSignature(presetName, preOrderedIdentifiers, preGroupings);

        // 🔑 关键技术：签名检查，避免重复渲染
        if (preGroupings.length === 0) {
            if (groupingUiExists) cleanupGroupingUi(listContainer);
            lastAppliedGroupingSignature = signature;
            lastAppliedGroupingPreset = presetName;
            lastAppliedGroupingListNode = listContainer[0];
            bindTripleClickEvents();
            return;
        }

        if (
            groupingUiExists
            && lastAppliedGroupingSignature === signature
            && lastAppliedGroupingPreset === presetName
            && lastAppliedGroupingListNode === listContainer[0]
        ) {
            bindTripleClickEvents();
            return;
        }

        // 保存当前展开状态
        listContainer.find('.peg-group-header').each(function () {
            const $header = $(this);
            const groupIndex = $header.data('group-index');
            const wrapper = $header.next('.peg-group-wrapper');
            const isExpanded = wrapper.is(':visible');
            if (groupIndex !== undefined) {
                groupExpandStates.set(`${presetName}-${groupIndex}`, isExpanded);
            }
        });

        // 清理之前的分组UI
        cleanupGroupingUi(listContainer);

        const items = listContainer.find('li[data-pm-identifier]').toArray();
        if (items.length === 0) {
            return;
        }

        const orderedIdentifiers = items
            .map((el) => el.getAttribute('data-pm-identifier'))
            .filter(Boolean);
        const unique = new Set(orderedIdentifiers);
        if (unique.size !== orderedIdentifiers.length) {
            console.warn('[ST-Grouping] duplicate data-pm-identifier detected; skipping grouping.');
            bindTripleClickEvents();
            return;
        }

        const groupings = getAllPresetGroupings(presetName, orderedIdentifiers);
        if (groupings.length === 0) {
            bindTripleClickEvents();
            return;
        }

        const unresolvedCount = groupings.filter((g) => g?.unresolved).length;
        if (unresolvedCount && window.toastr) {
            toastr.warning(`有 ${unresolvedCount} 个分组无法解析（已跳过）`);
        }

        const resolvedGroupings = groupings
            .map((g, index) => ({ ...g, originalIndex: index }))
            .filter((g) => !g.unresolved && typeof g.startIdentifier === 'string' && typeof g.endIdentifier === 'string')
            .map((g) => {
                const startIndex = orderedIdentifiers.indexOf(g.startIdentifier);
                const endIndex = orderedIdentifiers.indexOf(g.endIdentifier);
                if (startIndex === -1 || endIndex === -1) return null;
                return { ...g, startIndex, endIndex };
            })
            .filter(Boolean)
            .sort((a, b) => Math.min(b.startIndex, b.endIndex) - Math.min(a.startIndex, a.endIndex));

        // 零解析重试机制
        if (resolvedGroupings.length === 0) {
            if (zeroResolvedRetryPreset !== presetName) {
                zeroResolvedRetryPreset = presetName;
                zeroResolvedRetryCount = 0;
            }

            if (zeroResolvedRetryCount < 3) {
                zeroResolvedRetryCount += 1;
                setTimeout(() => scheduleApplyGrouping(0), 450);
                setTimeout(() => scheduleApplyGrouping(0), 1200);
            }
            bindTripleClickEvents();
            return;
        }
        zeroResolvedRetryPreset = null;
        zeroResolvedRetryCount = 0;

        // 创建所有分组UI
        for (const grouping of resolvedGroupings) {
            const start = Math.min(grouping.startIndex, grouping.endIndex);
            const end = Math.max(grouping.startIndex, grouping.endIndex);

            if (start < 0 || end >= items.length) continue;

            createGroupUI(items.slice(start, end + 1), grouping, presetName, grouping.originalIndex);
        }

        lastAppliedGroupingSignature = signature;
        lastAppliedGroupingPreset = presetName;
        lastAppliedGroupingListNode = listContainer[0];

        bindTripleClickEvents();
    } finally {
        // 🔑 关键：使用 setTimeout 确保在当前事件循环结束后重置
        setTimeout(() => {
            isApplyingGrouping = false;
        }, 0);
    }
}

// ==================== 创建分组 UI ====================

function createGroupUI(groupItems, grouping, presetName, groupIndex) {
    const $ = getJQuery();
    const $firstItem = $(groupItems[0]);

    const stateKey = `${presetName}-${groupIndex}`;
    const shouldExpand = groupExpandStates.get(stateKey) || false;

    const groupHeader = $(`
    <div class="peg-group-header${shouldExpand ? ' is-expanded' : ''}">
      <span class="peg-group-toggle" aria-hidden="true"></span>
      <span class="peg-group-name"></span>
      <span class="peg-group-count"></span>
      <button class="menu_button peg-icon-btn peg-group-edit-btn" title="编辑分组" aria-label="编辑分组">
        <span title="edit" class="fa-solid fa-pencil"></span>
      </button>
      <button class="menu_button peg-icon-btn peg-group-clear-btn" title="删除分组" aria-label="删除分组">
        <i class="fa-fw fa-solid fa-trash-can"></i>
      </button>
    </div>
  `);
    groupHeader.find('.peg-group-name').text(grouping.name || '分组');

    const totalCount = groupItems.length;
    let enabledCount = 0;
    groupItems.forEach((item) => {
        const $item = $(item);
        const $toggle = $item.find('.prompt-manager-toggle-action');
        if (!$toggle.length) {
            enabledCount += 1;
            return;
        }
        const isEnabled = !$toggle.hasClass('disabled') && !$toggle.hasClass('fa-toggle-off');
        if (isEnabled) enabledCount += 1;
    });
    groupHeader.find('.peg-group-count').text(`${totalCount}/${enabledCount}`);

    groupHeader.data('group-index', groupIndex);

    const groupWrapper = $(`<div class="peg-group-wrapper${shouldExpand ? ' is-expanded' : ''}"></div>`);

    $firstItem.before(groupHeader);
    $(groupItems).wrapAll(groupWrapper);

    // 折叠/展开
    groupHeader.find('.peg-group-toggle, .peg-group-name, .peg-group-count').on('click', () => {
        const wrapper = groupHeader.next('.peg-group-wrapper');
        const willBeExpanded = !groupHeader.hasClass('is-expanded');
        groupHeader.toggleClass('is-expanded', willBeExpanded);
        wrapper.toggleClass('is-expanded', willBeExpanded);
        groupExpandStates.set(stateKey, willBeExpanded);
    });

    // 编辑分组名称
    groupHeader.find('.peg-group-edit-btn').on('click', (e) => {
        e.stopPropagation();
        showInputDialog('请输入分组名称', grouping.name || '分组', async (newName) => {
            if (newName !== grouping.name) {
                await updatePresetGrouping(
                    presetName,
                    groupIndex,
                    grouping.startIdentifier,
                    grouping.endIdentifier,
                    newName,
                    getOrderedIdentifiersFromList(),
                );
                setTimeout(() => applyGroupingToList(), 200);
                if (window.toastr) toastr.success('分组名称已更新');
            }
        });
    });

    // 清除分组
    groupHeader.find('.peg-group-clear-btn').on('click', async (e) => {
        e.stopPropagation();
        if (confirm('确定要取消这个分组吗？')) {
            await removePresetGrouping(presetName, groupIndex, getOrderedIdentifiersFromList());
            resetTempMarks();
            setTimeout(() => applyGroupingToList(), 200);
            if (window.toastr) toastr.success('分组已取消');
        }
    });

    // 添加一键开关按钮
    const $groupWrapper = groupHeader.next('.peg-group-wrapper');
    if ($groupWrapper.length) {
        const groupItemElements = $groupWrapper.find('li[data-pm-identifier]').toArray();
        if (groupItemElements.length > 0) {
            addToggleAllButtonToGroupHeader(groupHeader, groupItemElements, async (enabled, items) => {
                await toggleAllEntriesInGroup(enabled, items);
            });
        }
    }
}

// ==================== 🔑 三连击事件处理 ====================

function bindTripleClickEvents() {
    const $ = getJQuery();
    const listContainer = findListContainer();
    if (!listContainer.length) return;

    listContainer.find('li[data-pm-identifier]').off('click.peg');

    const items = listContainer.find('li[data-pm-identifier]');
    let clickCount = 0;
    let clickTimer = null;
    let lastClickedIndex = -1;

    const resetClickState = () => {
        clickCount = 0;
        lastClickedIndex = -1;
    };

    items.each(function (index) {
        const $item = $(this);
        $item.on('click.peg', function (e) {
            // 🔑 关键：忽略按钮点击，避免误触发
            const $target = $(e.target);
            if ($target.closest('.prompt-manager-toggle-action, .prompt-manager-edit-action, .prompt-manager-detach-action, .prompt-manager-inspect-action, .peg-group-edit-btn, .peg-group-clear-btn').length) {
                return;
            }

            if (clickTimer) clearTimeout(clickTimer);

            if (lastClickedIndex === index) {
                clickCount++;
                if (clickCount >= 3) {
                    resetClickState();
                    e.preventDefault();
                    e.stopPropagation();
                    showGroupingMenu($item, e.clientX, e.clientY);
                    return;
                }
            } else {
                clickCount = 1;
                lastClickedIndex = index;
            }

            clickTimer = setTimeout(resetClickState, 1000);
        });
    });
}

// ==================== 输入对话框 ====================

function showInputDialog(title, defaultValue, callback) {
    const $ = getJQuery();
    const vars = CommonStyles.getVars();
    ensureViewportCssVars();

    const dialog = $(`
    <div class="peg-input-dialog" style="
      position: fixed; top: 0; left: 0; width: 100vw; height: 100vh; height: 100dvh; height: calc(var(--peg-vh, 1vh) * 100);
      background: rgba(0,0,0,0.5); z-index: 10005;
      display: flex; align-items: center; justify-content: center;
      padding-top: env(safe-area-inset-top); padding-bottom: env(safe-area-inset-bottom);">
      <div style="
        background: ${vars.bgColor}; padding: 20px; border-radius: 12px;
        min-width: 300px; box-shadow: 0 4px 20px rgba(0,0,0,0.3);">
        <div style="font-weight: 600; margin-bottom: 12px; white-space: nowrap;">${title}</div>
        <input type="text" class="dialog-input" value="${defaultValue}" style="
          width: 100%; padding: 8px; border: 1px solid ${vars.borderColor};
          border-radius: 6px; background: ${vars.inputBg}; color: ${vars.textColor};
          margin-bottom: 12px;">
        <div style="display: flex; flex-direction: row; gap: 8px; justify-content: flex-end;">
          <button class="dialog-cancel menu_button" style="padding: 6px 16px; white-space: nowrap;">取消</button>
          <button class="dialog-confirm menu_button" style="padding: 6px 16px; white-space: nowrap;">确定</button>
        </div>
      </div>
    </div>
  `);

    // 🔑 关键：将对话框插入到面板内部，避免触发"点击外部关闭面板"逻辑
    const panelContainer = findPanelContainer();
    (panelContainer.length ? panelContainer : $('body')).append(dialog);

    // 🔑 关键：阻止 pointerdown/mousedown/click 事件冒泡
    dialog.on('pointerdown mousedown click', (e) => e.stopPropagation());
    dialog.children().first().on('pointerdown mousedown click', (e) => e.stopPropagation());
    dialog.find('.dialog-input').focus().select();

    const closeDialog = (shouldCallback) => {
        const value = dialog.find('.dialog-input').val();
        dialog.remove();
        if (shouldCallback && value) callback(value);
    };

    dialog.find('.dialog-confirm').on('click', () => closeDialog(true));
    dialog.find('.dialog-cancel').on('click', () => closeDialog(false));
    dialog.find('.dialog-input').on('keypress', (e) => {
        if (e.key === 'Enter') closeDialog(true);
    });
}

// ==================== 分组菜单 ====================

function showGroupingMenu($item, x, y) {
    const $ = getJQuery();
    const presetName = getLoadedPresetName();
    if (!presetName) return;

    const identifier = $item.attr('data-pm-identifier');
    if (!identifier) return;

    $('.peg-menu').remove();

    const orderedIdentifiers = getOrderedIdentifiersFromList();
    const groupedIdentifiers = getGroupedIdentifierSet(presetName, orderedIdentifiers);
    if (groupedIdentifiers.has(identifier)) {
        if (window.toastr) toastr.info('该条目已在分组中，不能再次分组');
        return;
    }

    const vars = CommonStyles.getVars();
    const hasMarks = tempMarks.start !== null || tempMarks.end !== null;

    const menu = $(`
    <div class="peg-menu" style="
      position: fixed; left: ${x}px; top: ${y}px;
      background: ${vars.bgColor}; border: 1px solid ${vars.borderColor};
      border-radius: 8px; box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      z-index: 10004; padding: 4px; min-width: 140px;">
      <div class="menu-item set-start" style="padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 14px;">设为分组开始</div>
      <div class="menu-item set-end" style="padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 14px;">设为分组结束</div>
      ${hasMarks ? '<div class="menu-item clear-marks" style="padding: 8px 12px; cursor: pointer; border-radius: 4px; font-size: 14px; color: #ef4444;">清除标记</div>' : ''}
    </div>
  `);

    // 🔑 关键：将菜单插入到面板内部
    const panelContainer = findPanelContainer();
    (panelContainer.length ? panelContainer : $('body')).append(menu);

    // 🔑 关键：阻止事件冒泡
    menu.on('pointerdown mousedown click', (e) => e.stopPropagation());

    // 调整位置
    const menuRect = menu[0].getBoundingClientRect();
    if (menuRect.right > window.innerWidth) menu.css('left', (x - menuRect.width) + 'px');
    if (menuRect.bottom > window.innerHeight) menu.css('top', (y - menuRect.height) + 'px');

    // 悬停效果
    menu.find('.menu-item').hover(
        function () { $(this).css('background', vars.sectionBg); },
        function () { $(this).css('background', 'transparent'); }
    );

    // 处理标记完成
    const handleMarkComplete = async (isStart) => {
        const otherMark = isStart ? tempMarks.end : tempMarks.start;
        if (otherMark !== null) {
            showInputDialog('请输入分组名称', '分组', async (groupName) => {
                const startIndex = orderedIdentifiers.indexOf(tempMarks.start);
                const endIndex = orderedIdentifiers.indexOf(tempMarks.end);
                if (startIndex === -1 || endIndex === -1) {
                    resetTempMarks();
                    if (window.toastr) toastr.error('分组锚点无法解析，请重试');
                    return;
                }

                const start = Math.min(startIndex, endIndex);
                const end = Math.max(startIndex, endIndex);
                const hasOverlap = orderedIdentifiers.slice(start, end + 1).some((id) => groupedIdentifiers.has(id));
                if (hasOverlap) {
                    resetTempMarks();
                    if (window.toastr) toastr.error('选择范围包含已分组条目，请重新选择未分组的范围');
                    return;
                }

                await addPresetGrouping(
                    presetName,
                    tempMarks.start,
                    tempMarks.end,
                    groupName,
                    orderedIdentifiers,
                );
                resetTempMarks();
                setTimeout(() => applyGroupingToList(), 200);
                if (window.toastr) toastr.success('分组已创建');
            });
        } else {
            if (window.toastr) toastr.info(`已标记分组${isStart ? '开始' : '结束'}，请继续标记分组${isStart ? '结束' : '开始'}`);
        }
    };

    // 菜单项点击
    menu.find('.set-start').on('click', (e) => {
        e.stopPropagation();
        if (groupedIdentifiers.has(identifier)) {
            if (window.toastr) toastr.info('该条目已在分组中，不能作为分组起点');
            return;
        }
        tempMarks.start = identifier;
        menu.remove();
        $(document).off('click.peg-menu');
        handleMarkComplete(true);
    });

    menu.find('.set-end').on('click', (e) => {
        e.stopPropagation();
        if (groupedIdentifiers.has(identifier)) {
            if (window.toastr) toastr.info('该条目已在分组中，不能作为分组终点');
            return;
        }
        tempMarks.end = identifier;
        menu.remove();
        $(document).off('click.peg-menu');
        handleMarkComplete(false);
    });

    menu.find('.clear-marks').on('click', (e) => {
        e.stopPropagation();
        resetTempMarks();
        menu.remove();
        $(document).off('click.peg-menu');
        if (window.toastr) toastr.info('已清除临时标记');
    });

    // 点击外部关闭菜单
    setTimeout(() => {
        $(document).one('click.peg-menu', (e) => {
            if (!$(e.target).closest('.peg-menu').length) {
                menu.remove();
                $(document).off('click.peg-menu');
            }
        });
    }, 100);
}

// ==================== 初始化和销毁 ====================

export function initPromptEntryGrouping() {
    entryGroupingEnabled = true;
    installPromptManagerHook();
    setupPanelObserver();
    setupThemeReapplyListener();
    setupListObserver();
    setupToggleReapplyListener();

    // 初始应用分组
    scheduleApplyGrouping(600);
    scheduleApplyGrouping(1800);

    console.log('[ST-Grouping] 提示词条目分组已初始化');
}

export function destroyPromptEntryGrouping() {
    entryGroupingEnabled = false;
    teardownThemeReapplyListener();

    try {
        if (applyGroupingTimer) {
            clearTimeout(applyGroupingTimer);
            applyGroupingTimer = null;
        }
    } catch { }

    try {
        if (listObserver) {
            listObserver.disconnect();
            listObserver = null;
        }
        if (panelObserver) {
            panelObserver.disconnect();
            panelObserver = null;
        }
    } catch { }

    observedListNode = null;
    observedPanelNode = null;
    isApplyingGrouping = false;
    applyGroupingQueued = false;
    lastAppliedGroupingSignature = null;
    lastAppliedGroupingPreset = null;
    lastAppliedGroupingListNode = null;

    try {
        const listContainer = findListContainer();
        if (listContainer?.length) cleanupGroupingUi(listContainer);
    } catch { }

    console.log('[ST-Grouping] 提示词条目分组已销毁');
}

export { applyGroupingToList };
