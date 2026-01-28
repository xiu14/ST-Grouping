/**
 * ST-Grouping - 世界书分组管理模块
 * 原始来源: SillyTavern-WorldInfo-Groups/index.js
 * 
 * 功能：为世界书条目提供可折叠分组管理
 * - 创建/删除/重命名分组
 * - 将条目分配到分组
 * - 折叠/展开分组
 * - 自动清理孤立引用
 */

const MODULE_NAME = 'worldinfo_groups';

// 获取SillyTavern上下文
const getContext = () => SillyTavern.getContext();

// 默认设置
const defaultSettings = Object.freeze({
    enabled: true,
    // 按世界书名称存储分组数据
    // worldbooks: { "bookName": { groups: { "groupId": { name, collapsed, entries: [] } } } }
    worldbooks: {}
});

/**
 * 获取或初始化插件设置
 */
function getSettings() {
    const { extensionSettings } = getContext();

    if (!extensionSettings[MODULE_NAME]) {
        extensionSettings[MODULE_NAME] = structuredClone(defaultSettings);
    }

    // 确保所有默认字段存在
    for (const key of Object.keys(defaultSettings)) {
        if (!Object.hasOwn(extensionSettings[MODULE_NAME], key)) {
            extensionSettings[MODULE_NAME][key] = structuredClone(defaultSettings[key]);
        }
    }

    return extensionSettings[MODULE_NAME];
}

/**
 * 保存设置
 */
function saveSettings() {
    const { saveSettingsDebounced } = getContext();
    saveSettingsDebounced();
}

// 防抖保存折叠状态（避免频繁保存）
let collapseDebounceTimer = null;
function saveCollapseState() {
    if (collapseDebounceTimer) {
        clearTimeout(collapseDebounceTimer);
    }
    collapseDebounceTimer = setTimeout(() => {
        saveSettings();
        collapseDebounceTimer = null;
    }, 500);
}

/**
 * 生成UUID
 */
function generateId() {
    const { uuidv4 } = getContext();
    return uuidv4();
}

/**
 * 获取当前世界书的分组数据
 * @param {string} worldName 世界书名称
 */
function getWorldGroups(worldName) {
    const settings = getSettings();

    if (!settings.worldbooks[worldName]) {
        settings.worldbooks[worldName] = { groups: {}, groupOrder: [] };
    }

    // 兼容旧数据：确保 groupOrder 存在
    if (!settings.worldbooks[worldName].groupOrder) {
        settings.worldbooks[worldName].groupOrder = Object.keys(settings.worldbooks[worldName].groups);
    }

    return settings.worldbooks[worldName].groups;
}

/**
 * 获取分组顺序
 * @param {string} worldName 世界书名称
 */
function getGroupOrder(worldName) {
    const settings = getSettings();

    if (!settings.worldbooks[worldName]) {
        settings.worldbooks[worldName] = { groups: {}, groupOrder: [] };
    }

    // 兼容旧数据
    if (!settings.worldbooks[worldName].groupOrder) {
        settings.worldbooks[worldName].groupOrder = Object.keys(settings.worldbooks[worldName].groups);
    }

    // 清理不存在的分组ID
    const groups = settings.worldbooks[worldName].groups;
    settings.worldbooks[worldName].groupOrder = settings.worldbooks[worldName].groupOrder.filter(id => groups[id]);

    // 添加新分组到顺序中
    for (const groupId of Object.keys(groups)) {
        if (!settings.worldbooks[worldName].groupOrder.includes(groupId)) {
            settings.worldbooks[worldName].groupOrder.push(groupId);
        }
    }

    return settings.worldbooks[worldName].groupOrder;
}

/**
 * 设置分组顺序
 * @param {string} worldName 世界书名称
 * @param {string[]} order 分组ID顺序数组
 */
function setGroupOrder(worldName, order) {
    const settings = getSettings();

    if (settings.worldbooks[worldName]) {
        settings.worldbooks[worldName].groupOrder = order;
        saveSettings();
        return true;
    }

    return false;
}

/**
 * 将条目添加到分组
 * @param {string} worldName 世界书名称
 * @param {string} groupId 分组ID
 * @param {number|string} entryUid 条目UID
 */
function addEntryToGroup(worldName, groupId, entryUid) {
    const groups = getWorldGroups(worldName);
    const uid = Number(entryUid);

    // 先从其他分组中移除
    for (const gid in groups) {
        const idx = groups[gid].entries.findIndex(u => uidMatch(u, uid));
        if (idx !== -1) {
            groups[gid].entries.splice(idx, 1);
        }
    }

    // 添加到目标分组
    if (groups[groupId] && !isEntryInGroup(groups[groupId].entries, uid)) {
        groups[groupId].entries.push(uid);
        saveSettings();
        console.log(`[ST-Grouping] Added entry ${uid} to group`);
        return true;
    }

    return false;
}

/**
 * 从分组中移除条目
 * @param {string} worldName 世界书名称
 * @param {number|string} entryUid 条目UID
 */
function removeEntryFromGroup(worldName, entryUid) {
    const groups = getWorldGroups(worldName);
    const uid = Number(entryUid);

    for (const groupId in groups) {
        const idx = groups[groupId].entries.findIndex(u => uidMatch(u, uid));
        if (idx !== -1) {
            groups[groupId].entries.splice(idx, 1);
            saveSettings();
            console.log(`[ST-Grouping] Removed entry ${uid} from group`);
            return true;
        }
    }

    return false;
}

/**
 * 创建新分组
 * @param {string} worldName 世界书名称
 * @param {string} groupName 分组名称
 */
function createGroup(worldName, groupName) {
    const groups = getWorldGroups(worldName);
    const groupId = generateId();

    groups[groupId] = {
        name: groupName,
        collapsed: false,
        entries: []
    };

    saveSettings();
    console.log(`[ST-Grouping] Created group "${groupName}" in "${worldName}"`);

    return groupId;
}

/**
 * 删除分组
 * @param {string} worldName 世界书名称
 * @param {string} groupId 分组ID
 */
function deleteGroup(worldName, groupId) {
    const groups = getWorldGroups(worldName);

    if (groups[groupId]) {
        const groupName = groups[groupId].name;
        delete groups[groupId];
        saveSettings();
        console.log(`[ST-Grouping] Deleted group "${groupName}" from "${worldName}"`);
        return true;
    }

    return false;
}

/**
 * 重命名分组
 * @param {string} worldName 世界书名称
 * @param {string} groupId 分组ID
 * @param {string} newName 新名称
 */
function renameGroup(worldName, groupId, newName) {
    const groups = getWorldGroups(worldName);

    if (groups[groupId]) {
        groups[groupId].name = newName;
        saveSettings();
        return true;
    }

    return false;
}

/**
 * 切换分组折叠状态
 * @param {string} worldName 世界书名称
 * @param {string} groupId 分组ID
 */
function toggleGroupCollapse(worldName, groupId) {
    const groups = getWorldGroups(worldName);

    if (groups[groupId]) {
        groups[groupId].collapsed = !groups[groupId].collapsed;
        saveCollapseState(); // 使用防抖保存
        return groups[groupId].collapsed;
    }

    return false;
}

/**
 * 设置分组的条目
 * @param {string} worldName 世界书名称
 * @param {string} groupId 分组ID
 * @param {number[]} entryUids 条目UID列表（数字）
 */
function setGroupEntries(worldName, groupId, entryUids) {
    const groups = getWorldGroups(worldName);

    if (groups[groupId]) {
        // 确保保存为数字类型
        groups[groupId].entries = entryUids.map(uid => Number(uid));
        saveSettings();
        console.log(`[ST-Grouping] Set ${entryUids.length} entries for group in "${worldName}"`);
        return true;
    }

    return false;
}

/**
 * 检查UID是否匹配（处理数字/字符串类型差异）
 */
function uidMatch(uid1, uid2) {
    return String(uid1) === String(uid2);
}

/**
 * 检查条目是否在分组中
 */
function isEntryInGroup(groupEntries, entryUid) {
    return groupEntries.some(uid => uidMatch(uid, entryUid));
}

/**
 * 清理孤立引用（条目已删除但仍在分组中）
 * @param {string} worldName 世界书名称
 * @param {object} worldData 世界书数据
 */
function cleanOrphanedReferences(worldName, worldData) {
    const groups = getWorldGroups(worldName);
    const validUids = new Set(Object.keys(worldData.entries || {}).map(String));
    let cleaned = false;

    for (const groupId in groups) {
        const group = groups[groupId];
        const originalLength = group.entries.length;

        // 过滤掉不存在的条目
        group.entries = group.entries.filter(uid => validUids.has(String(uid)));

        if (group.entries.length !== originalLength) {
            cleaned = true;
            console.log(`[ST-Grouping] Cleaned ${originalLength - group.entries.length} orphaned entries from group "${group.name}"`);
        }
    }

    if (cleaned) {
        saveSettings();
    }

    return cleaned;
}

/**
 * 获取条目所属的分组ID
 * @param {string} worldName 世界书名称
 * @param {string|number} entryUid 条目UID
 */
function getEntryGroup(worldName, entryUid) {
    const groups = getWorldGroups(worldName);

    for (const groupId in groups) {
        if (isEntryInGroup(groups[groupId].entries, entryUid)) {
            return groupId;
        }
    }

    return null;
}

/**
 * 获取未分组的条目UID列表
 * @param {string} worldName 世界书名称
 * @param {object} worldData 世界书数据
 */
function getUngroupedEntries(worldName, worldData) {
    const groups = getWorldGroups(worldName);
    const allGroupedUids = new Set();

    for (const groupId in groups) {
        groups[groupId].entries.forEach(uid => allGroupedUids.add(String(uid)));
    }

    const allUids = Object.keys(worldData.entries || {});
    return allUids.filter(uid => !allGroupedUids.has(String(uid)));
}

// ==================== UI 渲染 ====================

let currentWorldName = null;
let currentWorldData = null;
let isRefreshing = false; // 防止重复刷新

/**
 * 注入分组工具栏
 */
function injectGroupsToolbar() {
    const existingToolbar = $('#wi-groups-toolbar');
    if (existingToolbar.length) {
        existingToolbar.remove();
    }

    const toolbar = $(`
        <div id="wi-groups-toolbar" class="wi-groups-toolbar">
            <div class="menu_button" id="wi-groups-new" title="创建新分组">
                <i class="fa-solid fa-folder-plus"></i>
                <span>新建分组</span>
            </div>
            <div class="menu_button" id="wi-groups-expand-all" title="展开所有分组">
                <i class="fa-solid fa-angles-down"></i>
            </div>
            <div class="menu_button" id="wi-groups-collapse-all" title="折叠所有分组">
                <i class="fa-solid fa-angles-up"></i>
            </div>
        </div>
    `);

    // 新建分组按钮
    toolbar.find('#wi-groups-new').on('click', async () => {
        if (!currentWorldName) return;

        const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = getContext();
        const result = await callGenericPopup('输入分组名称:', POPUP_TYPE.INPUT, '');

        if (result && typeof result === 'string' && result.trim()) {
            createGroup(currentWorldName, result.trim());
            await refreshGroupedView();
        }
    });

    // 展开所有
    toolbar.find('#wi-groups-expand-all').on('click', async () => {
        if (!currentWorldName) return;

        const groups = getWorldGroups(currentWorldName);
        for (const groupId in groups) {
            groups[groupId].collapsed = false;
        }
        saveSettings();
        await refreshGroupedView();
    });

    // 折叠所有
    toolbar.find('#wi-groups-collapse-all').on('click', async () => {
        if (!currentWorldName) return;

        const groups = getWorldGroups(currentWorldName);
        for (const groupId in groups) {
            groups[groupId].collapsed = true;
        }
        saveSettings();
        await refreshGroupedView();
    });

    // 插入到世界书编辑器顶部
    const worldPopup = $('#world_popup');
    const insertTarget = worldPopup.find('#world_popup_entries_list');

    if (insertTarget.length) {
        insertTarget.before(toolbar);
    }
}

/**
 * 创建分组容器HTML
 * @param {string} groupId 分组ID
 * @param {object} groupData 分组数据
 */
function createGroupContainer(groupId, groupData) {
    const isCollapsed = groupData.collapsed ? 'collapsed' : '';
    const entryCount = groupData.entries.length;

    const container = $(`
        <div class="wi-group-container" data-group-id="${groupId}">
            <div class="wi-group-header ${isCollapsed}">
                <i class="fa-solid fa-grip-vertical wi-group-drag-handle" draggable="true" title="拖拽排序"></i>
                <i class="fa-solid fa-chevron-down expand-icon"></i>
                <span class="wi-group-name">${escapeHtml(groupData.name)}</span>
                <span class="wi-group-count">${entryCount} 条目</span>
                <div class="wi-group-actions">
                    <div class="menu_button wi-group-edit" title="编辑分组">
                        <i class="fa-solid fa-pen"></i>
                    </div>
                    <div class="menu_button wi-group-delete" title="删除分组">
                        <i class="fa-solid fa-trash"></i>
                    </div>
                </div>
            </div>
            <div class="wi-group-preview">
                ${groupData.entries.length > 0 ? `包含: ${getEntryPreviewText(groupData.entries)}` : '(空分组)'}
            </div>
            <div class="wi-group-content ${isCollapsed}">
            </div>
        </div>
    `);

    // 点击头部切换折叠
    container.find('.wi-group-header').on('click', (e) => {
        if ($(e.target).closest('.wi-group-actions').length) return;

        const header = container.find('.wi-group-header');
        const content = container.find('.wi-group-content');
        const preview = container.find('.wi-group-preview');

        header.toggleClass('collapsed');
        content.toggleClass('collapsed');

        // 更新预览显示
        if (header.hasClass('collapsed')) {
            preview.show();
        } else {
            preview.hide();
        }

        toggleGroupCollapse(currentWorldName, groupId);
    });

    // 初始化预览显示状态
    if (!groupData.collapsed) {
        container.find('.wi-group-preview').hide();
    }

    // 编辑分组
    container.find('.wi-group-edit').on('click', async (e) => {
        e.stopPropagation();
        await showGroupEditPopup(groupId, groupData);
    });

    // 删除分组
    container.find('.wi-group-delete').on('click', async (e) => {
        e.stopPropagation();

        const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = getContext();
        const confirmed = await callGenericPopup(
            `确定要删除分组 "${groupData.name}" 吗？\n条目不会被删除，只会变为未分组状态。`,
            POPUP_TYPE.CONFIRM
        );

        if (confirmed === POPUP_RESULT.AFFIRMATIVE) {
            deleteGroup(currentWorldName, groupId);
            await refreshGroupedView();
        }
    });

    return container;
}

/**
 * 获取条目预览文本
 * @param {number[]} entryUids 条目UID列表
 */
function getEntryPreviewText(entryUids) {
    if (!currentWorldData || !currentWorldData.entries) return '';

    const names = entryUids.slice(0, 3).map(uid => {
        const entry = currentWorldData.entries[uid];
        if (!entry) return null;
        return entry.comment || entry.key?.join(', ') || `UID:${uid}`;
    }).filter(Boolean);

    if (entryUids.length > 3) {
        names.push(`...还有${entryUids.length - 3}个`);
    }

    return names.join(', ');
}

/**
 * 显示分组编辑弹窗
 * @param {string} groupId 分组ID
 * @param {object} groupData 分组数据
 */
async function showGroupEditPopup(groupId, groupData) {
    const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = getContext();

    // 构建条目选择列表
    const allEntries = Object.entries(currentWorldData.entries || {}).map(([uid, entry]) => ({
        uid: Number(uid),
        name: entry.comment || entry.key?.join(', ') || `UID:${uid}`,
        keys: entry.key?.join(', ') || '',
        selected: isEntryInGroup(groupData.entries, uid)
    }));

    // 按名称排序
    allEntries.sort((a, b) => a.name.localeCompare(b.name));

    const entryListHtml = allEntries.map(entry => `
        <div class="entry-item" data-uid="${entry.uid}">
            <input type="checkbox" ${entry.selected ? 'checked' : ''}>
            <span class="entry-name">${escapeHtml(entry.name)}</span>
            <span class="entry-keys">${escapeHtml(entry.keys)}</span>
        </div>
    `).join('');

    const popupContent = $(`
        <div class="wi-group-edit-popup">
            <div>
                <label>分组名称</label>
                <input type="text" id="wi-group-name-input" value="${escapeHtml(groupData.name)}" placeholder="输入分组名称">
            </div>
            <div>
                <label>选择要包含的条目 (${allEntries.length}个可用)</label>
                <div class="entry-selector">
                    ${entryListHtml || '<div style="padding:10px;text-align:center;color:var(--grey70)">没有可用的条目</div>'}
                </div>
            </div>
        </div>
    `);

    // 点击条目行也能切换选中状态
    popupContent.find('.entry-item').on('click', function (e) {
        if (e.target.type !== 'checkbox') {
            const checkbox = $(this).find('input[type="checkbox"]');
            checkbox.prop('checked', !checkbox.prop('checked'));
        }
    });

    const result = await callGenericPopup(popupContent, POPUP_TYPE.CONFIRM, '', {
        okButton: '保存',
        cancelButton: '取消',
        wide: true
    });

    if (result === POPUP_RESULT.AFFIRMATIVE) {
        // 获取新名称
        const newName = popupContent.find('#wi-group-name-input').val()?.trim();
        if (newName && newName !== groupData.name) {
            renameGroup(currentWorldName, groupId, newName);
        }

        // 获取选中的条目（保存为数字）
        const selectedUids = [];
        popupContent.find('.entry-item input[type="checkbox"]:checked').each(function () {
            const uid = $(this).closest('.entry-item').data('uid');
            selectedUids.push(Number(uid));
        });

        setGroupEntries(currentWorldName, groupId, selectedUids);
        await refreshGroupedView();
    }
}

/**
 * HTML转义
 */
function escapeHtml(text) {
    if (text == null) return '';
    const div = document.createElement('div');
    div.textContent = String(text);
    return div.innerHTML;
}

/**
 * 刷新分组视图
 */
async function refreshGroupedView() {
    // 防止重复刷新
    if (isRefreshing) {
        return;
    }

    if (!currentWorldName || !currentWorldData) {
        console.log('[ST-Grouping] No world data available');
        return;
    }

    isRefreshing = true;

    try {
        // 清理孤立引用
        cleanOrphanedReferences(currentWorldName, currentWorldData);

        const entriesList = $('#world_popup_entries_list');
        if (!entriesList.length) return;

        // 获取所有分组（按顺序）
        const groups = getWorldGroups(currentWorldName);
        const groupIds = getGroupOrder(currentWorldName);

        // 先把分组容器内的条目放回列表（避免被删除）
        entriesList.find('.wi-group-container .wi-group-content .world_entry').each(function () {
            entriesList.append($(this).detach());
        });

        // 再移除分组容器和未分组标题
        entriesList.find('.wi-group-container').remove();
        entriesList.find('.wi-ungrouped-header').remove();

        if (groupIds.length === 0) {
            // 没有分组，使用原始显示
            return;
        }

        // 获取未分组的条目
        const ungroupedUids = getUngroupedEntries(currentWorldName, currentWorldData);

        // 创建分组容器并插入条目
        let lastInserted = entriesList.find('.worldInfoKeywordHeaders');

        for (const groupId of groupIds) {
            const groupData = groups[groupId];
            const container = createGroupContainer(groupId, groupData);
            const contentArea = container.find('.wi-group-content');



            // 将属于该分组的条目移入容器
            for (const uid of groupData.entries) {
                // 尝试多种选择器匹配（无引号和有引号）
                let entryElement = entriesList.children(`.world_entry[uid="${uid}"]`);
                if (!entryElement.length) {
                    entryElement = entriesList.children(`.world_entry[uid=${uid}]`);
                }
                if (!entryElement.length) {
                    // 遍历查找
                    entriesList.children('.world_entry').each(function () {
                        const $el = $(this);
                        const elUid = $el.attr('uid');
                        if (String(elUid) === String(uid)) {
                            entryElement = $el;
                            return false; // break
                        }
                    });
                }

                if (entryElement.length) {
                    // 根据条目的constant状态设置data属性，用于边缘颜色区分
                    const entryData = currentWorldData.entries[uid];
                    if (entryData) {
                        const isConstant = entryData.constant === true;
                        entryElement.attr('data-wi-constant', isConstant ? 'true' : 'false');
                    }
                    contentArea.append(entryElement.detach());
                } else {

                }
            }

            // 将分组容器插入
            if (lastInserted.length) {
                lastInserted.after(container);
            } else {
                entriesList.prepend(container);
            }
            lastInserted = container;
        }

        // 添加未分组区域标题
        if (ungroupedUids.length > 0 && groupIds.length > 0) {
            const ungroupedHeader = $(`
                <div class="wi-ungrouped-header">
                    <i class="fa-solid fa-folder-open"></i>
                    未分组条目 (${ungroupedUids.length})
                </div>
            `);

            // 插入到最后一个分组容器之后
            const lastGroup = entriesList.find('.wi-group-container').last();
            if (lastGroup.length) {
                lastGroup.after(ungroupedHeader);
            }
        }
    } finally {
        // 确保无论如何都重置标志
        setTimeout(() => {
            isRefreshing = false;
            // 初始化拖拽和长按功能
            // initDragAndDrop(); // 已禁用 - 与长按粘贴冲突
            initGroupDragSort();
            initLongPressMenu();
        }, 50);
    }
}

// ==================== 拖拽功能 ====================

let draggedEntry = null;
let draggedGroup = null;

/**
 * 初始化拖拽功能 - 已禁用
 * 条目拖拽功能已禁用，因为它与长按粘贴操作冲突
 * 用户可以通过长按菜单来操作条目分组
 */
function initDragAndDrop() {
    // 功能已禁用 - 解决长按粘贴冲突问题
    // 用户可以通过长按条目弹出的菜单来添加/移除分组
    return;
}

/**
 * 初始化分组拖拽排序
 */
function initGroupDragSort() {
    const entriesList = $('#world_popup_entries_list');
    if (!entriesList.length) return;

    entriesList.off('dragstart.wigroupsort dragend.wigroupsort dragover.wigroupsort drop.wigroupsort');

    // 分组拖拽开始（通过拖拽把手）
    entriesList.on('dragstart.wigroupsort', '.wi-group-drag-handle', function (e) {
        const container = $(this).closest('.wi-group-container');
        draggedGroup = container[0];
        container.addClass('wi-dragging');
        e.originalEvent.dataTransfer.effectAllowed = 'move';
        e.originalEvent.dataTransfer.setData('text/plain', container.data('group-id'));
    });

    entriesList.on('dragend.wigroupsort', '.wi-group-drag-handle', function () {
        const container = $(this).closest('.wi-group-container');
        container.removeClass('wi-dragging');
        $('.wi-drag-over').removeClass('wi-drag-over');
        draggedGroup = null;
    });

    // 分组之间的拖拽排序
    entriesList.on('dragover.wigroupsort', '.wi-group-header', function (e) {
        if (!draggedGroup) return;

        e.preventDefault();
        const container = $(this).closest('.wi-group-container');

        if (container[0] !== draggedGroup) {
            container.addClass('wi-drag-over');
        }
    });

    entriesList.on('dragleave.wigroupsort', '.wi-group-header', function (e) {
        if (!$(e.relatedTarget).closest('.wi-group-header').length) {
            $(this).closest('.wi-group-container').removeClass('wi-drag-over');
        }
    });

    entriesList.on('drop.wigroupsort', '.wi-group-header', async function (e) {
        e.preventDefault();

        const targetContainer = $(this).closest('.wi-group-container');
        targetContainer.removeClass('wi-drag-over');

        if (!draggedGroup || !currentWorldName) return;

        const draggedGroupId = $(draggedGroup).data('group-id');
        const targetGroupId = targetContainer.data('group-id');

        if (draggedGroupId && targetGroupId && draggedGroupId !== targetGroupId) {
            // 更新分组顺序
            const order = getGroupOrder(currentWorldName);
            const fromIndex = order.indexOf(draggedGroupId);
            const toIndex = order.indexOf(targetGroupId);

            if (fromIndex !== -1 && toIndex !== -1) {
                order.splice(fromIndex, 1);
                order.splice(toIndex, 0, draggedGroupId);
                setGroupOrder(currentWorldName, order);
                await refreshGroupedView();
            }
        }
    });
}

// ==================== 长按快速分组菜单 ====================

let longPressTimer = null;
let longPressTarget = null;
let menuJustOpened = false; // 防止 click 事件立即关闭菜单
const LONG_PRESS_DURATION = 400; // 毫秒

/**
 * 初始化长按菜单
 */
function initLongPressMenu() {
    const entriesList = $('#world_popup_entries_list');
    if (!entriesList.length) return;

    entriesList.off('mousedown.wilongpress mouseup.wilongpress mouseleave.wilongpress');
    entriesList.off('touchstart.wilongpress touchend.wilongpress touchmove.wilongpress');
    entriesList.off('dragstart.wilongpresscancel');

    // 拖拽开始时取消长按（解决分组内拖拽触发弹窗问题）
    entriesList.on('dragstart.wilongpresscancel', '.world_entry', function () {
        clearLongPressTimer();
    });

    // 鼠标长按
    entriesList.on('mousedown.wilongpress', '.world_entry', function (e) {
        // 忽略右键和其他按钮
        if (e.button !== 0) return;
        // 忽略在输入框等元素上的点击
        if ($(e.target).is('input, textarea, select, button, a, .menu_button, .wi-group-drag-handle')) return;

        const entry = this;
        const entryUid = $(entry).attr('uid');

        longPressTarget = entry;
        longPressTimer = setTimeout(() => {
            showContextMenu(e.clientX, e.clientY, entryUid);
            // 标记菜单刚刚打开，防止 mouseup 后的 click 事件关闭它
            menuJustOpened = true;
            setTimeout(() => { menuJustOpened = false; }, 300);
        }, LONG_PRESS_DURATION);
    });

    entriesList.on('mouseup.wilongpress mouseleave.wilongpress', '.world_entry', function () {
        clearLongPressTimer();
    });

    // 触摸长按（移动端）
    entriesList.on('touchstart.wilongpress', '.world_entry', function (e) {
        if ($(e.target).is('input, textarea, select, button, a, .menu_button, .wi-group-drag-handle')) return;

        const touch = e.originalEvent.touches[0];
        const entry = this;
        const entryUid = $(entry).attr('uid');

        longPressTarget = entry;
        longPressTimer = setTimeout(() => {
            showContextMenu(touch.clientX, touch.clientY, entryUid);
            menuJustOpened = true;
            setTimeout(() => { menuJustOpened = false; }, 300);
        }, LONG_PRESS_DURATION);
    });

    entriesList.on('touchend.wilongpress touchmove.wilongpress', '.world_entry', function () {
        clearLongPressTimer();
    });

    // 点击其他地方关闭菜单（但要忽略刚打开时的 click）
    $(document).off('click.wicontextmenu mousedown.wicontextmenu').on('mousedown.wicontextmenu', function (e) {
        if (menuJustOpened) return; // 忽略刚打开时的点击
        if (!$(e.target).closest('.wi-context-menu').length) {
            hideContextMenu();
        }
    });
}

function clearLongPressTimer() {
    if (longPressTimer) {
        clearTimeout(longPressTimer);
        longPressTimer = null;
    }
    longPressTarget = null;
}

/**
 * 显示上下文菜单
 */
function showContextMenu(x, y, entryUid) {
    hideContextMenu();

    if (!currentWorldName) return;

    const groups = getWorldGroups(currentWorldName);
    const groupIds = getGroupOrder(currentWorldName);
    const currentGroupId = getEntryGroup(currentWorldName, entryUid);

    // 构建菜单项
    let menuItems = '';

    if (groupIds.length > 0) {
        menuItems += '<div class="wi-context-menu-header">添加到分组</div>';

        for (const groupId of groupIds) {
            const group = groups[groupId];
            if (!group) continue;

            const isInGroup = groupId === currentGroupId;
            const icon = isInGroup ? 'fa-check' : 'fa-folder';

            menuItems += `
                <div class="wi-context-menu-item" data-action="add" data-group-id="${groupId}" data-uid="${entryUid}">
                    <i class="fa-solid ${icon}"></i>
                    <span>${escapeHtml(group.name)}</span>
                </div>
            `;
        }

        if (currentGroupId) {
            menuItems += '<div class="wi-context-menu-divider"></div>';
            menuItems += `
                <div class="wi-context-menu-item remove" data-action="remove" data-uid="${entryUid}">
                    <i class="fa-solid fa-times"></i>
                    <span>移出分组</span>
                </div>
            `;
        }
    } else {
        menuItems = '<div class="wi-context-menu-header">暂无分组</div>';
        menuItems += `
            <div class="wi-context-menu-item" data-action="create" data-uid="${entryUid}">
                <i class="fa-solid fa-folder-plus"></i>
                <span>创建新分组</span>
            </div>
        `;
    }

    const menu = $(`
        <div class="wi-context-menu">
            ${menuItems}
        </div>
    `);

    // 定位菜单
    menu.css({
        left: Math.min(x, window.innerWidth - 200) + 'px',
        top: Math.min(y, window.innerHeight - 300) + 'px'
    });

    $('body').append(menu);

    // 绑定菜单项点击事件
    menu.find('.wi-context-menu-item').on('click', async function () {
        const action = $(this).data('action');
        const uid = $(this).data('uid');
        const groupId = $(this).data('group-id');

        hideContextMenu();

        if (action === 'add' && groupId) {
            addEntryToGroup(currentWorldName, groupId, uid);
            await refreshGroupedView();
        } else if (action === 'remove') {
            removeEntryFromGroup(currentWorldName, uid);
            await refreshGroupedView();
        } else if (action === 'create') {
            const { callGenericPopup, POPUP_TYPE, POPUP_RESULT } = getContext();
            const result = await callGenericPopup('输入分组名称:', POPUP_TYPE.INPUT, '');

            if (result && typeof result === 'string' && result.trim()) {
                const newGroupId = createGroup(currentWorldName, result.trim());
                addEntryToGroup(currentWorldName, newGroupId, uid);
                await refreshGroupedView();
            }
        }
    });
}

function hideContextMenu() {
    $('.wi-context-menu').remove();
}

// ==================== 移动端全局世界书选择器 ====================

let globalWorldSelectorInjected = false;

/**
 * 检测是否为移动端
 */
function isMobileDevice() {
    return window.matchMedia('(max-width: 1000px)').matches;
}

/**
 * 获取当前已选中的全局世界书
 */
function getSelectedWorldInfo() {
    // 从原生select获取选中的值
    const $nativeSelect = $('#world_info');
    if (!$nativeSelect.length) return [];

    const selectedValues = $nativeSelect.val() || [];
    return Array.isArray(selectedValues) ? selectedValues : [selectedValues].filter(Boolean);
}

/**
 * 获取所有可用的世界书列表
 */
function getAllWorldBooks() {
    const $nativeSelect = $('#world_info');
    if (!$nativeSelect.length) return [];

    const worldBooks = [];
    $nativeSelect.find('option').each(function () {
        const $option = $(this);
        const value = $option.val();
        const text = $option.text();

        // 跳过空值和占位符
        if (!value || value === '' || text.includes('not found')) return;

        worldBooks.push({
            value: value,
            name: text
        });
    });

    return worldBooks;
}

/**
 * 注入移动端全局世界书选择器
 */
function injectGlobalWorldSelector() {
    // 只在移动端注入
    if (!isMobileDevice()) {
        removeGlobalWorldSelector();
        return;
    }

    const $wiMultiSelector = $('#WIMultiSelector');
    if (!$wiMultiSelector.length) return;

    // 如果已经注入，只更新内容
    if (globalWorldSelectorInjected && $('#wi-global-world-selector').length) {
        updateGlobalWorldSelectorContent();
        return;
    }

    // 隐藏原生的select2容器
    $wiMultiSelector.find('.range-block-range').hide();

    // 移除已有的自定义选择器
    $('#wi-global-world-selector').remove();

    // 创建自定义选择器
    const $selector = $(`
        <div id="wi-global-world-selector" class="wi-global-world-selector">
            <div class="wi-gws-header" id="wi-gws-toggle">
                <span class="wi-gws-label">点击选择全局世界书</span>
                <span class="wi-gws-count">0 个已选</span>
                <i class="fa-solid fa-chevron-down wi-gws-arrow"></i>
            </div>
            <div class="wi-gws-dropdown" style="display: none;">
                <div class="wi-gws-search-wrapper">
                    <i class="fa-solid fa-search"></i>
                    <input type="text" class="wi-gws-search" placeholder="搜索世界书...">
                </div>
                <div class="wi-gws-list"></div>
                <div class="wi-gws-actions">
                    <div class="wi-gws-btn wi-gws-clear">清空全部</div>
                    <div class="wi-gws-btn wi-gws-done">完成</div>
                </div>
            </div>
        </div>
    `);

    $wiMultiSelector.find('.range-block-range').after($selector);

    // 绑定事件
    bindGlobalWorldSelectorEvents($selector);

    // 更新内容
    updateGlobalWorldSelectorContent();

    globalWorldSelectorInjected = true;
    console.log('[ST-Grouping] Mobile global world selector injected');
}

/**
 * 移除移动端选择器
 */
function removeGlobalWorldSelector() {
    $('#wi-global-world-selector').remove();
    $('#WIMultiSelector .range-block-range').show();
    globalWorldSelectorInjected = false;
}

/**
 * 更新选择器内容
 */
function updateGlobalWorldSelectorContent() {
    const $selector = $('#wi-global-world-selector');
    if (!$selector.length) return;

    const worldBooks = getAllWorldBooks();
    const selectedValues = getSelectedWorldInfo();

    // 更新列表
    const $list = $selector.find('.wi-gws-list');
    $list.empty();

    if (worldBooks.length === 0) {
        $list.html('<div class="wi-gws-empty">没有可用的世界书</div>');
    } else {
        worldBooks.forEach(book => {
            const isSelected = selectedValues.includes(book.value);
            const $item = $(`
                <div class="wi-gws-item ${isSelected ? 'selected' : ''}" data-value="${escapeHtml(book.value)}">
                    <div class="wi-gws-checkbox">
                        <i class="fa-solid ${isSelected ? 'fa-square-check' : 'fa-square'}"></i>
                    </div>
                    <span class="wi-gws-item-name">${escapeHtml(book.name)}</span>
                </div>
            `);
            $list.append($item);
        });
    }

    // 更新计数
    updateSelectedCount();
}

/**
 * 更新已选计数
 */
function updateSelectedCount() {
    const selectedValues = getSelectedWorldInfo();
    const $count = $('#wi-global-world-selector .wi-gws-count');
    $count.text(`${selectedValues.length} 个已选`);
}

/**
 * 绑定选择器事件
 */
function bindGlobalWorldSelectorEvents($selector) {
    const $header = $selector.find('#wi-gws-toggle');
    const $dropdown = $selector.find('.wi-gws-dropdown');
    const $searchInput = $selector.find('.wi-gws-search');
    const $list = $selector.find('.wi-gws-list');

    // 切换下拉框
    $header.on('click', function (e) {
        e.stopPropagation();
        const isOpen = $dropdown.is(':visible');

        if (isOpen) {
            closeGlobalWorldDropdown();
        } else {
            openGlobalWorldDropdown();
        }
    });

    // 搜索过滤
    $searchInput.on('input', function () {
        const searchTerm = $(this).val().toLowerCase();
        $list.find('.wi-gws-item').each(function () {
            const name = $(this).find('.wi-gws-item-name').text().toLowerCase();
            $(this).toggle(name.includes(searchTerm));
        });
    });

    // 阻止搜索框点击冒泡
    $searchInput.on('click', function (e) {
        e.stopPropagation();
    });

    // 选中/取消选中项目
    $selector.on('click', '.wi-gws-item', function (e) {
        e.stopPropagation();

        const $item = $(this);
        const value = $item.data('value');
        const isSelected = $item.hasClass('selected');

        // 更新UI
        if (isSelected) {
            $item.removeClass('selected');
            $item.find('.wi-gws-checkbox i').removeClass('fa-square-check').addClass('fa-square');
        } else {
            $item.addClass('selected');
            $item.find('.wi-gws-checkbox i').removeClass('fa-square').addClass('fa-square-check');
        }

        // 同步到原生select
        syncToNativeSelect();
    });

    // 清空全部
    $selector.on('click', '.wi-gws-clear', function (e) {
        e.stopPropagation();
        $list.find('.wi-gws-item').removeClass('selected');
        $list.find('.wi-gws-checkbox i').removeClass('fa-square-check').addClass('fa-square');
        syncToNativeSelect();
    });

    // 完成按钮
    $selector.on('click', '.wi-gws-done', function (e) {
        e.stopPropagation();
        closeGlobalWorldDropdown();
    });

    // 点击其他地方关闭
    $(document).on('click.wigws', function (e) {
        if (!$(e.target).closest('#wi-global-world-selector').length) {
            closeGlobalWorldDropdown();
        }
    });
}

/**
 * 打开下拉框
 */
function openGlobalWorldDropdown() {
    const $selector = $('#wi-global-world-selector');
    const $dropdown = $selector.find('.wi-gws-dropdown');
    const $arrow = $selector.find('.wi-gws-arrow');

    $dropdown.slideDown(200);
    $arrow.addClass('rotated');
    $selector.addClass('open');

    // 更新内容
    updateGlobalWorldSelectorContent();
}

/**
 * 关闭下拉框
 */
function closeGlobalWorldDropdown() {
    const $selector = $('#wi-global-world-selector');
    const $dropdown = $selector.find('.wi-gws-dropdown');
    const $arrow = $selector.find('.wi-gws-arrow');

    $dropdown.slideUp(200);
    $arrow.removeClass('rotated');
    $selector.removeClass('open');

    // 清空搜索
    $selector.find('.wi-gws-search').val('');
    $selector.find('.wi-gws-item').show();
}

/**
 * 同步选择到原生select
 */
function syncToNativeSelect() {
    const $nativeSelect = $('#world_info');
    if (!$nativeSelect.length) return;

    const selectedValues = [];
    $('#wi-global-world-selector .wi-gws-item.selected').each(function () {
        selectedValues.push($(this).data('value'));
    });

    // 设置原生select的值
    $nativeSelect.val(selectedValues);

    // 触发change事件让ST保存设置
    $nativeSelect.trigger('change');

    // 更新计数
    updateSelectedCount();

    console.log('[ST-Grouping] Synced global world selection:', selectedValues);
}

// ==================== 事件监听 ====================

/**
 * 初始化世界书分组功能
 */
export function initWorldInfoGrouping() {
    const { eventSource, event_types } = getContext();

    console.log('[ST-Grouping] Initializing WorldInfo Groups...');

    // 监听世界书更新事件
    eventSource.on(event_types.WORLDINFO_UPDATED, async (data) => {
        console.log('[ST-Grouping] World info updated');
        if (currentWorldName && currentWorldData) {
            // 重新加载世界书数据
            const { loadWorldInfo } = getContext();
            currentWorldData = await loadWorldInfo(currentWorldName);
            await refreshGroupedView();
        }
    });

    // 监听条目加载完成事件
    eventSource.on(event_types.WORLDINFO_ENTRIES_LOADED, async () => {
        console.log('[ST-Grouping] Entries loaded');
        if (currentWorldName) {
            setTimeout(() => refreshGroupedView(), 100);
        }
    });

    // 使用 MutationObserver 监听世界书编辑器打开
    const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
                const worldPopup = document.getElementById('world_popup');
                if (worldPopup && worldPopup.style.display !== 'none') {
                    onWorldEditorOpen();
                }
            }
        }
    });

    // 等待 DOM 加载完成后开始观察
    const startObserver = () => {
        const worldPopup = document.getElementById('world_popup');

        if (worldPopup) {
            observer.observe(worldPopup, { attributes: true, attributeFilter: ['style'] });
        }
    };

    // 监听世界书选择变化
    $(document).on('change', '#world_editor_select', async function () {
        const selectedIndex = $(this).val();
        const selectedText = $(this).find('option:selected').text();

        if (selectedIndex && selectedText) {
            currentWorldName = selectedText;

            // 尝试获取世界书数据
            const { loadWorldInfo } = getContext();
            currentWorldData = await loadWorldInfo(currentWorldName);

            console.log(`[ST-Grouping] World selected: ${currentWorldName}`, currentWorldData);

            // 注入工具栏
            injectGroupsToolbar();

            // 延迟刷新视图，等待条目渲染完成
            setTimeout(() => refreshGroupedView(), 300);
        }
    });

    // 监听条目entryStateSelector状态变化，实时更新边缘颜色
    // 使用通用祖先选择器以支持分组内外的条目
    $(document).on('change', 'select[name="entryStateSelector"]', function () {
        const $entry = $(this).closest('.world_entry');
        const stateValue = $(this).val();
        const isConstant = stateValue === 'constant';
        $entry.attr('data-wi-constant', isConstant ? 'true' : 'false');
        console.log(`[ST-Grouping] Entry state changed to: ${stateValue}, isConstant: ${isConstant}`);
    });

    // APP_READY 事件
    eventSource.on(event_types.APP_READY, () => {
        console.log('[ST-Grouping] App ready, starting observer');
        startObserver();
    });

    // 如果 APP 已经准备好，立即启动
    if (document.getElementById('world_popup')) {
        startObserver();
    }

    // 监听窗口大小变化，切换移动端/桌面端选择器
    let resizeDebounce = null;
    $(window).on('resize', function () {
        if (resizeDebounce) clearTimeout(resizeDebounce);
        resizeDebounce = setTimeout(() => {
            // 检查WorldInfo面板是否打开
            const $worldInfo = $('#WorldInfo');
            if ($worldInfo.hasClass('openDrawer') || !$worldInfo.hasClass('closedDrawer')) {
                injectGlobalWorldSelector();
            }
        }, 200);
    });

    // 监听WorldInfo抽屉打开
    const worldInfoObserver = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
            if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
                const $worldInfo = $('#WorldInfo');
                if ($worldInfo.hasClass('openDrawer') || !$worldInfo.hasClass('closedDrawer')) {
                    // 延迟注入，等待DOM渲染
                    setTimeout(() => injectGlobalWorldSelector(), 100);
                }
            }
        }
    });

    // 开始观察WorldInfo抽屉
    const startWorldInfoObserver = () => {
        const worldInfoDrawer = document.getElementById('WorldInfo');
        if (worldInfoDrawer) {
            worldInfoObserver.observe(worldInfoDrawer, { attributes: true, attributeFilter: ['class'] });
        }
    };

    // 延迟启动WorldInfo观察器
    if (document.getElementById('WorldInfo')) {
        startWorldInfoObserver();
    } else {
        eventSource.on(event_types.APP_READY, startWorldInfoObserver);
    }

    console.log('[ST-Grouping] WorldInfo Groups initialized successfully');
}

/**
 * 世界书编辑器打开时的处理
 */
async function onWorldEditorOpen() {
    console.log('[ST-Grouping] World editor opened');

    // 获取当前选中的世界书
    const selectedText = $('#world_editor_select option:selected').text();

    if (selectedText) {
        currentWorldName = selectedText;

        const { loadWorldInfo } = getContext();
        currentWorldData = await loadWorldInfo(currentWorldName);

        // 注入工具栏
        injectGroupsToolbar();

        // 注入移动端全局世界书选择器
        setTimeout(() => injectGlobalWorldSelector(), 100);

        // 延迟刷新视图
        setTimeout(() => refreshGroupedView(), 300);
    }
}
