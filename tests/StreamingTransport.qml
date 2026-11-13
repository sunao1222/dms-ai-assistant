import QtQuick
import Quickshell
import Quickshell.Io
import qs.Services

ShellRoot {
    id: root
    property int phase: 0
    readonly property string expectedError: Quickshell.env("DMS_TEST_EXPECTED_ERROR")
    readonly property string cancelMode: Quickshell.env("DMS_TEST_CANCEL")

    AIAssistantService {
        id: service
        modelDiscoveryConfig: "custom|" + Quickshell.env("DMS_TEST_URL") + "|" + Quickshell.env("DMS_TEST_KEY")
    }

    Timer {
        interval: 100
        running: true
        onTriggered: {
            root.phase = 1
            if (root.cancelMode === "models") {
                service.refreshAvailableModels(true)
                return
            }
            if (root.cancelMode === "credentials") {
                PluginService.savePluginData(service.pluginId, "apiKey", "forgotten-legacy")
                PluginService.savePluginData(service.pluginId, "providers", {
                    custom: { baseUrl: Quickshell.env("DMS_TEST_URL"), model: "stub-model",
                              saveApiKey: false, apiKey: "forgotten-custom" },
                    openai: { saveApiKey: false, apiKey: "forgotten-openai" },
                    anthropic: { baseUrl: Quickshell.env("DMS_TEST_URL"), model: "stub-model",
                                 saveApiKey: true, apiKey: "anthropic-saved" }
                })
                const profiles = PluginService.loadPluginData(service.pluginId, "providers", {})
                if (profiles.custom.apiKey || profiles.openai.apiKey ||
                        profiles.anthropic.apiKey !== "anthropic-saved" ||
                        PluginService.loadPluginData(service.pluginId, "apiKey", "")) {
                    console.error("Credential cleanup failed")
                    Qt.exit(1)
                    return
                }
                service.sessionApiKey = "custom-session"
                PluginService.savePluginData(service.pluginId, "provider", "anthropic")
                if (service.sessionApiKey || service.resolveApiKey() !== "anthropic-saved") {
                    console.error("Credential leaked across providers")
                    Qt.exit(1)
                    return
                }
                PluginService.savePluginData(service.pluginId, "provider", "custom")
                if (service.sessionApiKey !== "custom-session" || service.resolveApiKey() !== "custom-session") {
                    console.error("Provider session key was not restored")
                    Qt.exit(1)
                    return
                }
                console.log("TRANSPORT_CREDENTIALS_OK")
                Qt.quit()
                return
            }
            if (root.cancelMode === "ollama-error") {
                PluginService.savePluginData(service.pluginId, "providers", {
                    ollama: { baseUrl: Quickshell.env("DMS_TEST_URL"), model: "stub-model" }
                })
                PluginService.savePluginData(service.pluginId, "provider", "ollama")
            }
            service.sendMessage("first")
            if (root.cancelMode === "duplicate")
                service.sendMessage("ignored while streaming")
            if (root.cancelMode === "immediate")
                service.cancel()
        }
    }

    FileView {
        path: root.cancelMode === "in-flight" || root.cancelMode === "config-switch"
              ? Quickshell.env("DMS_TEST_SIGNAL") : ""
        watchChanges: true
        onFileChanged: reload()
        onLoaded: {
            if (root.phase === 1 && text() === "received") {
                if (root.cancelMode === "config-switch")
                    service.baseUrl = Quickshell.env("DMS_TEST_URL") + "/"
                else
                    service.cancel()
            }
        }
    }

    Timer {
        interval: 10000
        running: true
        onTriggered: {
            console.error("Transport test timed out", root.phase, service.isStreaming)
            Qt.exit(1)
        }
    }

    Connections {
        target: service
        function onModelsLoadingChanged() {
            if (root.cancelMode !== "models" || root.phase !== 1 || service.modelsLoading)
                return
            Qt.callLater(() => {
                if (service.modelsError || service.availableModels.join(",") !== "model-a,model-b") {
                    console.error("Unexpected model discovery result", service.modelsError, service.availableModels)
                    Qt.exit(1)
                    return
                }
                console.log("TRANSPORT_MODELS_OK")
                Qt.quit()
            })
        }
        function onIsStreamingChanged() {
            if (service.isStreaming || root.phase === 0)
                return

            const last = service.messagesModel.get(service.messagesModel.count - 1)

            if (root.expectedError) {
                if (last.status !== "error" || last.content !== root.expectedError) {
                    console.error("Unexpected startup result", last.status, last.content)
                    Qt.exit(1)
                    return
                }
                console.log("TRANSPORT_ERROR_OK")
                Qt.quit()
                return
            }
            if (root.cancelMode === "duplicate") {
                if (last.status !== "ok" || last.content !== "part A + B") {
                    console.error("Duplicate send interrupted response", last.status, last.content)
                    Qt.exit(1)
                    return
                }
                console.log("TRANSPORT_DUPLICATE_OK")
                Qt.quit()
                return
            }
            if (root.cancelMode && root.phase === 1) {
                if (last.status !== "error" || last.content !== "Cancelled") {
                    console.error("Unexpected cancellation result", last.status, last.content)
                    Qt.exit(1)
                    return
                }
                root.phase = 2
                Qt.callLater(() => service.sendMessage("second"))
                return
            }

            if (last.status !== "ok" || last.content !== "part A + B") {
                console.error("Unexpected streaming result", root.phase, last.status, last.content)
                Qt.exit(1)
                return
            }

            if (root.phase === 1) {
                root.phase = 2
                Qt.callLater(() => service.sendMessage("second"))
            } else {
                console.log("TRANSPORT_STREAMING_OK")
                Qt.quit()
            }
        }
    }
}
