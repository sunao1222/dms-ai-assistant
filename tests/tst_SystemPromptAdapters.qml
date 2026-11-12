import QtQuick
import QtTest
import "../AIApiAdapters.js" as Adapters

TestCase {
    name: "SystemPromptAdapters"

    property var providers: ["openai", "custom", "inception", "ollama", "anthropic", "gemini"]
    property string prompt: "  日本語\n\"keep\"  "

    function payload() {
        return {
            model: "test-model",
            messages: [
                { role: "user", content: "first question" },
                { role: "assistant", content: "first answer" },
                { role: "user", content: "second question" }
            ],
            max_tokens: 1234,
            temperature: 0.8,
            geminiWebSearch: true,
            inceptionReasoningEffort: "high",
            inceptionReasoningSummary: true,
            inceptionReasoningSummaryWait: true
        };
    }

    function bodyFor(provider, input) {
        return JSON.parse(Adapters.buildRequest(provider, input, "test-key").body);
    }

    function checkBody(provider, body, expectedPrompt) {
        const hasPrompt = expectedPrompt !== "";
        const messages = provider === "gemini" ? body.contents : body.messages;
        const embedded = hasPrompt && provider !== "anthropic" && provider !== "gemini";
        compare(messages.length, 3 + (embedded ? 1 : 0), provider + " conversation length");
        if (embedded) {
            compare(messages[0].role, "system", provider + " system role");
            compare(messages[0].content, expectedPrompt, provider + " system content");
        }
        const roles = ["user", "assistant", "user"];
        const contents = ["first question", "first answer", "second question"];
        for (let i = 0; i < roles.length; i++) {
            const message = messages[i + (embedded ? 1 : 0)];
            compare(message.role, provider === "gemini" && roles[i] === "assistant" ? "model" : roles[i],
                    provider + " role " + i);
            if (provider === "gemini") {
                compare(message.parts.length, 1);
                compare(message.parts[0].text, contents[i], provider + " content " + i);
            } else {
                compare(message.content, contents[i], provider + " content " + i);
            }
        }
        if (provider === "anthropic") {
            compare(Object.prototype.hasOwnProperty.call(body, "system"), hasPrompt);
            if (hasPrompt)
                compare(body.system, expectedPrompt);
        } else if (provider === "gemini") {
            compare(Object.prototype.hasOwnProperty.call(body, "systemInstruction"), hasPrompt);
            if (hasPrompt) {
                compare(body.systemInstruction.parts.length, 1);
                compare(body.systemInstruction.parts[0].text, expectedPrompt);
            }
            compare(body.tools.length, 1);
            verify(Object.prototype.hasOwnProperty.call(body.tools[0], "google_search"));
            compare(Object.keys(body.tools[0].google_search).length, 0);
            compare(body.generationConfig.temperature, 0.8);
            compare(body.generationConfig.maxOutputTokens, 1234);
        }
        if (provider === "inception") {
            compare(body.reasoning_effort, "high");
            compare(body.reasoning_summary, true);
            compare(body.reasoning_summary_wait, true);
            compare(body.temperature, 0.8);
            compare(body.max_tokens, 1234);
        }
    }

    function test_promptAndRepeatedBuild() {
        for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            const input = payload();
            input.systemPrompt = prompt;
            checkBody(provider, bodyFor(provider, input), prompt);
            checkBody(provider, bodyFor(provider, input), prompt);
        }
    }

    function test_absentAndBlankPrompt() {
        for (let i = 0; i < providers.length; i++) {
            const provider = providers[i];
            const missing = payload();
            checkBody(provider, bodyFor(provider, missing), "");
            const empty = payload();
            empty.systemPrompt = "";
            checkBody(provider, bodyFor(provider, empty), "");
            const whitespace = payload();
            whitespace.systemPrompt = " \n\t";
            checkBody(provider, bodyFor(provider, whitespace), "");
        }
    }
}
