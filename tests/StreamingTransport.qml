import QtQuick
import Quickshell
import Quickshell.Io

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
            service.sendMessage("first")
            if (root.cancelMode === "immediate")
                service.cancel()
        }
    }

    FileView {
        path: root.cancelMode === "in-flight" ? Quickshell.env("DMS_TEST_SIGNAL") : ""
        watchChanges: true
        onFileChanged: reload()
        onLoaded: {
            if (root.phase === 1 && text() === "received")
                service.cancel()
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
