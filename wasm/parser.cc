#include <string>
#include <vector>
#include <sstream>
#include <emscripten/bind.h>

struct DnrRule {
    int id;
    int priority;
    std::string conditionUrlFilter;
    std::vector<std::string> resourceTypes;
};

// Einfache Funktion, um eine Regel in einen JSON-String umzuwandeln (stark vereinfacht)
std::string ruleToJson(const DnrRule& rule) {
    std::ostringstream ss;
    ss << R"({"id": )" << rule.id << R"(, "priority": )" << rule.priority
       << R"(, "action": {"type": "block"}, "condition": {)";
    if (!rule.conditionUrlFilter.empty()) {
         ss << R"("urlFilter": ")" << rule.conditionUrlFilter << R"(")";
    }
     // Füge ResourceTypes hinzu...
    ss << R"(, "resourceTypes": ["main_frame", "sub_frame", "script", "xmlhttprequest"] )"; // Vereinfacht
    ss << R"(}})";
    return ss.str();
}

std::string parseFilterListWasm(std::string filterListText) {
    std::vector<DnrRule> rules;
    std::stringstream ss(filterListText);
    std::string line;
    int ruleId = 1;

    while (std::getline(ss, line, '\n')) {
        // Trimme Leerzeichen (vereinfacht)
        line.erase(0, line.find_first_not_of(" \t\r\n"));
        line.erase(line.find_last_not_of(" \t\r\n") + 1);

        if (line.empty() || line[0] == '!') continue;

        if (line.rfind("||", 0) == 0 && line.back() == '^') {
            std::string domain = line.substr(2, line.length() - 3);
            if (!domain.empty()) {
                 DnrRule rule;
                 rule.id = ruleId++;
                 rule.priority = 1;
                 rule.conditionUrlFilter = "||" + domain + "/";
                 // rule.resourceTypes = ... // Fülle alle Typen
                 rules.push_back(rule);
            }
        }
        // ... komplexere Regeln ...
    }

    // Baue den finalen JSON-String (Array von Regeln)
    std::ostringstream resultJson;
    resultJson << "[";
    for (size_t i = 0; i < rules.size(); ++i) {
        resultJson << ruleToJson(rules[i]);
        if (i < rules.size() - 1) {
            resultJson << ",";
        }
    }
    resultJson << "]";
    return resultJson.str();
}

EMSCRIPTEN_BINDINGS(filter_parser_module) {
    emscripten::function("parseFilterListWasm", &parseFilterListWasm);
}
