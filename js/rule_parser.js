// js/rule_parser.js (Version mit kleinen Batches, Pausen und Limit-Logging)

/**
 * Parses a filter list text (like EasyList format) and converts supported rules
 * into Chrome's Declarative Net Request (DNR) rule format.
 * // ... (restlicher Doc-Kommentar wie gehabt) ...
 */
export async function parseFilterList(filterListText) {
    const lines = filterListText.split(/\r?\n/);
    const rules = [];
    let ruleId = 1; // Start ID

    const defaultResourceTypes = [
      "main_frame", "sub_frame", "stylesheet", "script", "image",
      "font", "object", "xmlhttprequest", "ping", "csp_report",
      "media", "websocket", "webtransport", "webbundle", "other"
    ];

    console.log(`Starting parsing of ${lines.length} lines...`);

    for (const line of lines) {
        const trimmedLine = line.trim();
        if (trimmedLine.length === 0 || trimmedLine.startsWith('!') || trimmedLine.startsWith('[')) {
            continue;
        }
        const parts = trimmedLine.split('$');
        const filterPart = parts[0];
        const optionsPart = parts.length > 1 ? parts[1] : '';
        let condition = { resourceTypes: [...defaultResourceTypes] };
        let isValidRule = false;

        if (filterPart.startsWith('||') && filterPart.endsWith('^')) {
            const domain = filterPart.substring(2, filterPart.length - 1);
            if (domain && !domain.includes('*')) {
                condition.urlFilter = `||${domain}/`;
                isValidRule = true;
            } else {
                 console.warn(`Skipping rule with invalid domain in filter: ${filterPart}`);
            }
        } else {
             continue; // Skip unsupported formats
        }

        if (isValidRule && optionsPart) {
            const options = optionsPart.split(',');
            for (const option of options) {
                if (option.startsWith('domain=')) {
                    const domainList = option.substring('domain='.length).split('|');
                    const initiatorDomains = [];
                    const excludedInitiatorDomains = [];
                    domainList.forEach(d => {
                        const cleanDomain = d.trim();
                        if (cleanDomain.startsWith('~')) {
                            const excludedDomain = cleanDomain.substring(1);
                            if (excludedDomain) excludedInitiatorDomains.push(excludedDomain);
                        } else {
                            if (cleanDomain) initiatorDomains.push(cleanDomain);
                        }
                    });
                    if (excludedInitiatorDomains.length > 0) {
                         if (condition.initiatorDomains) {
                             console.warn(`Rule has both positive and negative domains, ignoring positive due to DNR limitations: ${trimmedLine}`);
                             delete condition.initiatorDomains;
                         }
                        condition.excludedInitiatorDomains = excludedInitiatorDomains;
                    } else if (initiatorDomains.length > 0) {
                        condition.initiatorDomains = initiatorDomains;
                    }
                } // else { /* Skip unsupported options */ }
            }
        }

        if (isValidRule) {
             if (Object.keys(condition).length > (condition.resourceTypes ? 1 : 0)) {
                rules.push({ id: ruleId++, priority: 1, action: { type: "block" }, condition: condition });
            } else {
                 console.warn(`Skipping rule as condition seems empty after parsing: ${trimmedLine}`);
            }
        }
    }
    console.log(`Finished parsing. Generated ${rules.length} DNR rules. Starting ID: ${rules.length > 0 ? rules[0].id : 'N/A'}`);
    return rules;
}


/**
 * Updates the dynamic rules used by the declarativeNetRequest API.
 * Removes old rules, then adds new rules in small batches with delays.
 * Includes detailed logging and limit check.
 *
 * @param {Array<chrome.declarativeNetRequest.Rule>} rules The array of new DNR rules to apply.
 * @returns {Promise<void>} A promise that resolves when the update attempt is complete.
 */
export async function updateRules(rules) {
    // Get the maximum number of dynamic rules allowed by the browser.
    const MAX_DYNAMIC_RULES = chrome.declarativeNetRequest.MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES || 5000;
    console.log("Effective MAX_NUMBER_OF_DYNAMIC_AND_SESSION_RULES:", MAX_DYNAMIC_RULES); // Log des Limits
    let effectiveRules = rules;

    // Check if the number of rules exceeds the limit.
    if (rules.length > MAX_DYNAMIC_RULES) {
        console.warn(`Rule limit exceeded: Parsed ${rules.length} rules, limit is ${MAX_DYNAMIC_RULES}. Truncating.`);
        effectiveRules = rules.slice(0, MAX_DYNAMIC_RULES);
    }
    const ruleCount = effectiveRules.length;

    try {
        // --- Schritt 1: Hole und entferne ALLE existierenden dynamischen Regeln ---
        console.log("Getting existing dynamic rules...");
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        const existingRuleIds = existingRules.map(rule => rule.id);
        console.log(`Found ${existingRuleIds.length} existing rule IDs.`);

        if (existingRuleIds.length > 0) {
            console.log(`Attempting to remove ${existingRuleIds.length} rules...`);
            await chrome.declarativeNetRequest.updateDynamicRules({
                removeRuleIds: existingRuleIds
            });
            console.log("Removal operation completed.");

            // Kurze Prüfung nach dem Entfernen
            try {
                const rulesAfterRemove = await chrome.declarativeNetRequest.getDynamicRules();
                console.log(`Rules present *after* removal attempt: ${rulesAfterRemove.length} IDs.`);
            } catch (getErr) {
                console.error("Error getting rules after removal:", getErr);
            }
        } else {
            console.log("No existing dynamic rules found to remove.");
        }

        // --- Schritt 2: Füge die neuen Regeln in kleinen Batches mit Pausen hinzu ---
        if (effectiveRules.length > 0) {
            const BATCH_SIZE = 100; // Noch kleinere Batch-Größe
            console.log(`Attempting to add ${effectiveRules.length} new rules in batches of ${BATCH_SIZE}...`);

            for (let i = 0; i < effectiveRules.length; i += BATCH_SIZE) {
                const batch = effectiveRules.slice(i, i + BATCH_SIZE);
                if (batch.length === 0) continue;

                const startId = batch[0].id;
                const endId = batch[batch.length - 1].id;
                console.log(`Adding batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} rules (IDs ${startId} to ${endId})...`);

                await chrome.declarativeNetRequest.updateDynamicRules({
                    addRules: batch
                });
                 console.log(`Batch (IDs ${startId}-${endId}) added.`);
                 // *** PAUSE ZWISCHEN BATCHES AKTIVIERT ***
                 console.log("Waiting briefly before next batch...");
                 await new Promise(resolve => setTimeout(resolve, 50)); // 50ms Pause
            }
            console.log("All batches added successfully.");
        } else {
            console.log("No new rules parsed to add.");
        }

        // --- Schritt 3: Statistik speichern ---
        await chrome.storage.local.set({ ruleCount: ruleCount });
        console.log(`Stored rule count: ${ruleCount}`);

        // --- Schritt 4: Badge leeren ---
         if (chrome.action && chrome.action.setBadgeText) {
             try {
                 const currentBadgeText = await chrome.action.getBadgeText({});
                 if (currentBadgeText && !currentBadgeText.includes('ERR')) {
                    await chrome.action.setBadgeText({ text: '' });
                 } else if (!currentBadgeText) {
                     await chrome.action.setBadgeText({ text: '' });
                 }
             } catch (badgeError) {
                 console.warn("Could not access or clear badge:", badgeError.message);
             }
         }

    } catch (error) {
        // Fehlerbehandlung
        console.error("Critical error during declarativeNetRequest.updateDynamicRules:", error);

        // Log-Ausgabe des Zustands nach dem Fehler
        try {
            const rulesAfterError = await chrome.declarativeNetRequest.getDynamicRules();
            console.log(`Rules present *after* error occurred: ${rulesAfterError.length} IDs:`, rulesAfterError.map(r => r.id));
        } catch (getErr) {
            console.error("Error getting rules after error:", getErr);
        }

        // Fehler im Badge anzeigen
        if (chrome.action && chrome.action.setBadgeText && chrome.action.setBadgeBackgroundColor) {
            try {
                 await chrome.action.setBadgeText({ text: 'UPD ERR' });
                 await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
            } catch (badgeError) {
                console.error("Failed to set update error badge:", badgeError);
            }
        }
    }
}