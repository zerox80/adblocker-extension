// background/background.js (Using JavaScript Parser)

// Importiere die benötigten Funktionen aus dem JS-Modul
import { parseFilterList, updateRules } from '../js/rule_parser.js';

// Globale Variable für Zähler (Platzhalter/Schätzung)
let blockedRequestsCount = 0; // Dieser Zähler wird aktuell NICHT für blockierte Anfragen verwendet

// --- HILFSFUNKTION: Badge leeren ---
async function clearBadge() {
    try {
        await chrome.action.setBadgeText({ text: '' });
    } catch (error) {
        // Ignoriere Fehler, falls der Badge nicht gesetzt werden kann (z.B. während Initialisierung)
        // console.warn("Could not clear badge:", error.message);
    }
}

// --- HILFSFUNKTION: Fehler-Badge setzen ---
async function setErrorBadge(text = 'ERR') {
     try {
        await chrome.action.setBadgeText({ text });
        await chrome.action.setBadgeBackgroundColor({ color: '#FF0000' });
     } catch (error) {
        console.warn("Could not set error badge:", error.message);
     }
}


// Initialisierungsfunktion, die den JavaScript-Parser verwendet
async function initialize() {
  console.log("Initializing AdBlocker (using JavaScript Parser)...");
  await clearBadge(); // Badge beim Start leeren
  try {
    // 1. Filterliste holen
    const response = await fetch('../filter_lists/filter.txt');
    if (!response.ok) {
      throw new Error(`Failed to fetch filter list: ${response.statusText} (Status: ${response.status})`);
    }
    const filterListText = await response.text();
    console.log(`Workspaceed filter list (${filterListText.length} chars).`);

    // 2. Filterliste mit JavaScript parsen
    console.time("JavaScript Parsing");
    const rules = await parseFilterList(filterListText);
    console.timeEnd("JavaScript Parsing");
    console.log(`Parsed ${rules.length} rules via JavaScript.`);

    // 3. Regeln mit declarativeNetRequest anwenden
    await updateRules(rules); // updateRules setzt jetzt auch den ruleCount im Storage

    // 4. Initialisiere lokale Statistik-Zähler (optional, wird nicht für Badge genutzt)
    const stats = await chrome.storage.local.get(['blockedCount']);
    blockedRequestsCount = stats.blockedCount || 0;

    // 5. Badge nach erfolgreicher Initialisierung leeren (oder auf 'ON' setzen, falls gewünscht)
    await clearBadge();
    // Optional: Zeige "ON" an, wenn alles okay ist
    // await chrome.action.setBadgeText({ text: 'ON' });
    // await chrome.action.setBadgeBackgroundColor({ color: '#008000' }); // Grün

    console.log("Initialization complete (JavaScript).");

  } catch (error) {
    console.error("Initialization failed (JavaScript):", error);
    await setErrorBadge(); // Fehler im Badge anzeigen
  }
}

// === Event Listeners ===

// Listener für das Installations-/Update-Event
chrome.runtime.onInstalled.addListener(details => {
  console.log("Extension installed or updated:", details.reason);
  initialize();
});

// Listener für den Start des Browsers
chrome.runtime.onStartup.addListener(async () => {
    console.log("Browser startup detected.");
    // Regeln sind persistent. Lade nur Zähler falls nötig.
    const stats = await chrome.storage.local.get(['blockedCount']);
    blockedRequestsCount = stats.blockedCount || 0;
    console.log(`Loaded initial blocked count: ${blockedRequestsCount}`);
    // Stelle sicher, dass der Badge leer ist oder den letzten Status (z.B. Fehler) anzeigt
    const currentBadge = await chrome.action.getBadgeText({});
    if (!currentBadge || currentBadge.includes('r')) { // Nur leeren, wenn kein Fehler angezeigt wird
       await clearBadge();
    }
    // Optional: Rufe initialize() auf, um sicherzustellen, dass Regeln aktuell sind,
    // aber updateRules entfernt und fügt Regeln jedes Mal neu hinzu. Nur bei Bedarf.
    // initialize();
});

// Listener für Änderungen im Storage
chrome.storage.onChanged.addListener((changes, namespace) => {
  // Aktualisiere Badge NICHT mehr basierend auf ruleCount
  /*
  if (namespace === 'local' && changes.ruleCount) {
    // const newRuleCount = changes.ruleCount.newValue || 0;
    // chrome.action.setBadgeText({ text: `${newRuleCount}r` }); // ENTFERNT
    // chrome.action.setBadgeBackgroundColor({ color: '#FFA500' }); // ENTFERNT
    // console.log(`Rule count changed to: ${newRuleCount}`);
  }
  */

   // Zähler-Update (wird nicht für Badge verwendet)
   if (namespace === 'local' && changes.blockedCount) {
       const newBlockedCount = changes.blockedCount.newValue || 0;
       blockedRequestsCount = newBlockedCount;
   }
});

// Listener für Nachrichten vom Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "getStats") {
    // Hole aktuelle Werte aus dem Storage für die Regelanzahl
    chrome.storage.local.get(['ruleCount']).then(stats => {
        sendResponse({
            ruleCount: stats.ruleCount || 0,
            blockedCount: blockedRequestsCount // Sende den Platzhalter-Zähler
        });
    });
    return true; // Asynchron
  }
  if (request.action === "reloadRules") {
      console.log("Reloading rules triggered by message...");
      initialize().then(async () => {
          // Kurze Verzögerung, damit der Badge-Status von initialize() übernommen wird
          await new Promise(resolve => setTimeout(resolve, 100));
          sendResponse({ success: true, message: "Rules reloaded." });
      }).catch(error => {
          console.error("Failed to reload rules:", error);
          sendResponse({ success: false, message: `Failed to reload rules: ${error.message}` });
      });
      return true; // Asynchron
  }

  return false;
});

// Starte die Initialisierung, wenn der Service Worker (neu) startet
initialize();