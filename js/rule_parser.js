// js/rule_parser.js (Fixed: Ensures unique IDs by removing existing rules before adding)

/**
 * Parses a filter list text (EasyList-like) into Chrome DNR rules.
 * @param {string} filterListText
 * @returns {Promise<chrome.declarativeNetRequest.Rule[]>}
 */
export async function parseFilterList(filterListText) {
    const lines = filterListText.split(/\r?\n/);
    const rules = [];
    let ruleId = 1;
    const defaultResourceTypes = [
      "main_frame", "sub_frame", "stylesheet", "script", "image",
      "font", "object", "xmlhttprequest", "ping", "csp_report",
      "media", "websocket", "webtransport", "webbundle", "other"
    ];
  
    console.log(`Starting parsing of ${lines.length} lines...`);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('!') || trimmed.startsWith('[')) continue;
      const parts = trimmed.split('$');
      const filterPart = parts[0];
      const optionsPart = parts[1] || '';
      let condition = { resourceTypes: [...defaultResourceTypes] };
      let valid = false;
  
      if (filterPart.startsWith('||') && filterPart.endsWith('^')) {
        const domain = filterPart.slice(2, -1);
        if (domain && !domain.includes('*')) {
          condition.urlFilter = `||${domain}/`;
          valid = true;
        }
      }
  
      if (valid && optionsPart) {
        for (const opt of optionsPart.split(',')) {
          if (opt.startsWith('domain=')) {
            const domains = opt.slice(7).split('|');
            const inc = [], exc = [];
            for (const d of domains) {
              const dm = d.trim();
              if (!dm) continue;
              if (dm.startsWith('~')) exc.push(dm.slice(1)); else inc.push(dm);
            }
            if (exc.length) {
              delete condition.initiatorDomains;
              condition.excludedInitiatorDomains = exc;
            } else if (inc.length) {
              condition.initiatorDomains = inc;
            }
          }
        }
      }
  
      if (valid && Object.keys(condition).length > 1) {
        rules.push({ id: ruleId++, priority: 1, action: { type: 'block' }, condition });
      }
    }
  
    console.log(`Parsed ${rules.length} rules.`);
    return rules;
  }
  
  /**
   * Updates DNR rules: removes all existing, then adds new ones in batches.
   * @param {chrome.declarativeNetRequest.Rule[]} rules
   */
  export async function updateRules(rules) {
    const MAX = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;
    let toAdd = rules;
    if (rules.length > MAX) {
      console.warn(`Truncating from ${rules.length} to ${MAX} rules`);
      toAdd = rules.slice(0, MAX);
    }
  
    try {
      // 1) Remove existing rules
      const existing = await chrome.declarativeNetRequest.getDynamicRules();
      const existingIds = existing.map(r => r.id);
      if (existingIds.length) {
        console.log(`Removing ${existingIds.length} existing rules...`);
        await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: existingIds });
      }
  
      // 2) Add new rules in batches
      const BATCH = 100;
      for (let i = 0; i < toAdd.length; i += BATCH) {
        const batch = toAdd.slice(i, i + BATCH);
        console.log(`Adding rules ${i + 1}-${i + batch.length} of ${toAdd.length}`);
        await chrome.declarativeNetRequest.updateDynamicRules({ addRules: batch });
        await new Promise(r => setTimeout(r, 50));
      }
  
      // 3) Store count
      await chrome.storage.local.set({ ruleCount: toAdd.length });
  
      // 4) Clear badge if no error
      if (chrome.action?.setBadgeText) {
        const badge = await chrome.action.getBadgeText({});
        if (!badge || !badge.includes('ERR')) {
          await chrome.action.setBadgeText({ text: '' });
        }
      }
  
    } catch (err) {
      console.error('Error updating rules:', err);
      // Optionally re-fetch rules to log
      try {
        const after = await chrome.declarativeNetRequest.getDynamicRules();
        console.log(`Rules after error: ${after.map(r => r.id)}`);
      } catch {}
      // Set error badge
      if (chrome.action?.setBadgeText && chrome.action.setBadgeBackgroundColor) {
        await chrome.action.setBadgeText({ text: 'UPD ERR' });
        await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
      }
    }
  }
  