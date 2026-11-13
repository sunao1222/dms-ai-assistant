const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('chat input preserves a draft during streaming and sends it afterwards', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-ai-chat-input-'));
    const put = (name, content) => {
        const target = path.join(fixture, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    };
    try {
        fs.copyFileSync(path.join(__dirname, '../AIAssistant.qml'), path.join(fixture, 'AIAssistant.qml'));
        put('Quickshell/qmldir', 'module Quickshell\nsingleton Quickshell 1.0 Quickshell.qml\n');
        put('Quickshell/Quickshell.qml', 'pragma Singleton\nimport QtQuick\nQtObject { function execDetached(command) {} }\n');
        put('qs/Common/qmldir', 'module qs.Common\nsingleton Theme 1.0 Theme.qml\nsingleton I18n 1.0 I18n.qml\n');
        put('qs/Common/I18n.qml', 'pragma Singleton\nimport QtQuick\nQtObject { function tr(text) { return text } }\n');
        put('qs/Common/Theme.qml', `pragma Singleton
import QtQuick
QtObject {
    property int spacingXS: 4; property int spacingS: 8; property int spacingM: 16
    property int spacingL: 24; property int spacingXL: 32; property int cornerRadius: 8
    property int fontSizeSmall: 12; property int fontSizeMedium: 14; property int fontSizeLarge: 18
    property string fontFamily: "sans-serif"; property int fontWeight: Font.Normal
    property int shortDuration: 0; property int standardEasing: Easing.Linear
    property real popupTransparency: 1
    property color surfaceVariant: "gray"; property color surfaceVariantText: "black"
    property color success: "green"; property color surfaceContainer: "white"
    property color surfaceContainerHigh: "white"; property color surfaceVariantAlpha: "gray"
    property color surfaceText: "black"; property color surfaceTextMedium: "gray"
    property color primary: "blue"; property color outlineMedium: "gray"
    property color outlineButton: "gray"; property color error: "red"
    function withAlpha(color, alpha) { return color }
}`);
        put('qs/Services/qmldir', 'module qs.Services\nsingleton SettingsData 1.0 SettingsData.qml\n');
        put('qs/Services/SettingsData.qml', 'pragma Singleton\nimport QtQuick\nQtObject { property real popupTransparency: 1 }\n');
        put('qs/Widgets/qmldir', 'module qs.Widgets\nStyledText 1.0 StyledText.qml\nDankButton 1.0 DankButton.qml\nDankActionButton 1.0 DankActionButton.qml\nDankDropdown 1.0 DankDropdown.qml\n');
        put('qs/Widgets/StyledText.qml', 'import QtQuick\nText {}\n');
        put('qs/Widgets/DankButton.qml', 'import QtQuick\nItem { property string text; property string iconName; signal clicked() }\n');
        put('qs/Widgets/DankActionButton.qml', 'import QtQuick\nItem { property string iconName; property string tooltipText; property int buttonSize; property int iconSize; property color iconColor; signal clicked() }\n');
        put('qs/Widgets/DankDropdown.qml', 'import QtQuick\nItem { property var options; property string currentValue; signal valueChanged(string value) }\n');
        put('MessageList.qml', 'import QtQuick\nItem { property var messages; property var aiService; property bool useMonospace; signal copySuccess() }\n');
        put('AIAssistantSettings.qml', 'import QtQuick\nItem { property bool isVisible; property string pluginId; property var aiService; signal closeRequested(); function commitSystemPromptDraft() {} }\n');
        put('tst_ChatInput.qml', `import QtQuick
import QtTest
TestCase {
    id: testCase
    name: "ChatInput"
    when: windowShown
    visible: true
    width: 480; height: 640
    QtObject {
        id: service
        property bool isStreaming: false
        property int messageCount: 0
        property int streamStartedAtMs: 0
        property string provider: "custom"
        property string baseUrl: "http://localhost:11434"
        property bool isOnline: true
        property bool currentModelDiscovered: false
        property bool useMonospace: false
        property var messagesModel: null
        property int sendCount: 0
        property string lastSent: ""
        function resolveApiKey() { return "key" }
        function sendMessage(text) { sendCount++; lastSent = text }
    }
    AIAssistant { id: panel; anchors.fill: parent; aiService: service }
    function test_streaming_draft_then_send() {
        const composer = findChild(panel, "composer")
        verify(composer !== null)
        service.sendCount = 0
        service.isStreaming = true
        composer.text = "  draft message  "
        composer.forceActiveFocus()
        tryVerify(() => composer.activeFocus)
        keyClick(Qt.Key_Return)
        compare(service.sendCount, 0)
        compare(composer.text, "  draft message  ")
        service.isStreaming = false
        keyClick(Qt.Key_Return)
        compare(service.sendCount, 1)
        compare(service.lastSent, "draft message")
        compare(composer.text, "")
    }
    function test_privacy_note_uses_hostname() {
        service.provider = "custom"
        service.baseUrl = "http://localhost:11434"
        compare(panel.privacyNote(), "Local endpoint detected.")
        service.baseUrl = "http://127.0.0.1:8080/v1"
        compare(panel.privacyNote(), "Local endpoint detected.")
        service.baseUrl = "https://localhost.example/v1"
        compare(panel.privacyNote(), "Remote provider (CUSTOM): avoid sensitive data.")
        service.baseUrl = "https://example.com/localhost"
        compare(panel.privacyNote(), "Remote provider (CUSTOM): avoid sensitive data.")
    }
}`);
        const runner = process.env.QML_TEST_RUNNER || '/usr/lib/qt6/bin/qmltestrunner';
        const result = spawnSync(runner, ['-input', fixture, '-import', fixture, '-o', '-,txt'], {
            encoding: 'utf8', timeout: 30000,
            env: { ...process.env, QT_QPA_PLATFORM: 'offscreen', QT_QUICK_BACKEND: 'software' },
        });
        assert.ifError(result.error);
        assert.equal(result.status, 0, result.stdout + result.stderr);
    } finally {
        fs.rmSync(fixture, { recursive: true, force: true });
    }
});
