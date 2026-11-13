const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

test('disabling remembered credentials removes saved copies but preserves the session', () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'dms-ai-settings-auth-'));
    const put = (name, content) => {
        const target = path.join(fixture, name);
        fs.mkdirSync(path.dirname(target), { recursive: true });
        fs.writeFileSync(target, content);
    };
    try {
        fs.copyFileSync(path.join(__dirname, '../AIAssistantSettings.qml'), path.join(fixture, 'AIAssistantSettings.qml'));
        put('qs/Common/qmldir', 'module qs.Common\nsingleton Theme 1.0 Theme.qml\nsingleton I18n 1.0 I18n.qml\n');
        put('qs/Common/I18n.qml', 'pragma Singleton\nimport QtQuick\nQtObject { function tr(s) { return s } }\n');
        put('qs/Common/Theme.qml', `pragma Singleton
import QtQuick
QtObject {
    property color background: "#202124"; property color surfaceVariantAlpha: "#555555"
    property color surfaceText: "white"; property color surfaceVariantText: "#bdbdbd"
    property color surfaceContainer: "#303034"; property color surfaceContainerHigh: "#29292d"
    property color primary: "blue"; property color outlineMedium: "gray"; property color outline: "white"
    property color error: "red"; property int cornerRadius: 8
    property int spacingXS: 4; property int spacingS: 8; property int spacingM: 12
    property int spacingL: 16; property int spacingXL: 24; property int iconSize: 24
    property int fontSizeSmall: 12; property int fontSizeMedium: 16; property int fontSizeLarge: 18
    property int fontWeight: Font.Normal; property string fontFamily: "sans-serif"
    property real popupTransparency: 1
    function withAlpha(c, a) { return Qt.rgba(c.r, c.g, c.b, a) }
}`);
        put('qs/Services/qmldir', 'module qs.Services\nsingleton PluginService 1.0 PluginService.qml\n');
        put('qs/Services/PluginService.qml', `pragma Singleton
import QtQuick
QtObject {
    property var data: ({})
    signal pluginDataChanged(string pluginId)
    function savePluginData(id, key, value) {
        const next = Object.assign({}, data); next[key] = value; data = next
        pluginDataChanged(id)
    }
    function loadPluginData(id, key, fallback) { return data[key] === undefined ? fallback : data[key] }
}`);
        put('qs/Widgets/qmldir', `module qs.Widgets
StyledText 1.0 StyledText.qml
DankButton 1.0 DankButton.qml
DankFlickable 1.0 DankFlickable.qml
DankIcon 1.0 DankIcon.qml
DankDropdown 1.0 DankDropdown.qml
DankTextField 1.0 DankTextField.qml
DankTextCursor 1.0 DankTextCursor.qml
DankToggle 1.0 DankToggle.qml
DankSlider 1.0 DankSlider.qml
`);
        put('qs/Widgets/StyledText.qml', 'import QtQuick\nText {}\n');
        put('qs/Widgets/DankButton.qml', 'import QtQuick\nItem { property string text; property string iconName; signal clicked(); implicitWidth: 90; implicitHeight: 32 }\n');
        put('qs/Widgets/DankFlickable.qml', 'import QtQuick\nFlickable {}\n');
        put('qs/Widgets/DankIcon.qml', 'import QtQuick\nItem { property string name; property int size; property color color; width: size; height: size }\n');
        put('qs/Widgets/DankDropdown.qml', 'import QtQuick\nItem { property var options; property string currentValue; signal valueChanged(string value); implicitHeight: 32 }\n');
        put('qs/Widgets/DankTextField.qml', 'import QtQuick\nTextInput { property string placeholderText; property string leftIconName; height: 32 }\n');
        put('qs/Widgets/DankTextCursor.qml', 'import QtQuick\nRectangle { property bool shown; function resetBlink() {} }\n');
        put('qs/Widgets/DankToggle.qml', `import QtQuick
Item {
    property bool checked; signal toggled(bool checked); implicitWidth: 40; implicitHeight: 28
    MouseArea { anchors.fill: parent; onClicked: parent.toggled(!parent.checked) }
}`);
        put('qs/Widgets/DankSlider.qml', 'import QtQuick\nItem { property real minimum; property real maximum; property real step; property real value; property bool showValue; signal sliderValueChanged(real newValue) }\n');
        put('tst_SettingsAuth.qml', `import QtQuick
import QtTest
import qs.Services
TestCase {
    id: testCase
    name: "SettingsAuth"
    when: windowShown
    visible: true
    width: 720; height: 1200
    property var panel
    property var toggle
    QtObject {
        id: service
        property var availableModels: []; property var selectableModels: []
        property bool modelsLoading: false; property bool modelsError: false
        property string sessionApiKey: ""
        function modelDiscoveryStatusText() { return "" }
        function refreshAvailableModels(force) {}
        function setCurrentModel(value) {}
    }
    Component {
        id: settingsComponent
        AIAssistantSettings { width: testCase.width; height: testCase.height; isVisible: true; aiService: service }
    }
    function init() {
        service.sessionApiKey = ""
        PluginService.data = {
            provider: "openai", apiKey: "stored-key", saveApiKey: true,
            providers: {
                openai: {apiKey: "stored-key", saveApiKey: true},
                anthropic: {apiKey: "other-key", saveApiKey: true}
            }
        }
        panel = createTemporaryObject(settingsComponent, testCase)
        verify(panel !== null)
        toggle = findChild(panel, "rememberApiKeyToggle")
        verify(toggle !== null)
    }
    function test_disabling_and_reenabling_remember() {
        verify(toggle.checked)
        mouseClick(toggle)
        compare(PluginService.data.providers.openai.saveApiKey, false)
        compare(PluginService.data.providers.openai.apiKey, "")
        compare(PluginService.data.apiKey, "")
        compare(PluginService.data.providers.anthropic.apiKey, "other-key")
        compare(service.sessionApiKey, "stored-key")
        mouseClick(toggle)
        compare(PluginService.data.providers.openai.saveApiKey, true)
        compare(PluginService.data.providers.openai.apiKey, "stored-key")
        compare(PluginService.data.apiKey, "stored-key")
        compare(service.sessionApiKey, "")
    }
    function test_disabling_preserves_existing_session_key() {
        service.sessionApiKey = "session-key"
        mouseClick(toggle)
        compare(service.sessionApiKey, "session-key")
        compare(PluginService.data.providers.openai.apiKey, "")
        compare(PluginService.data.apiKey, "")
    }
    function test_editing_remembered_key_replaces_session_override() {
        service.sessionApiKey = "old-session-key"
        const field = findChild(panel, "apiKeyField")
        verify(field !== null)
        field.forceActiveFocus()
        tryVerify(() => field.activeFocus)
        field.selectAll()
        keyClick(Qt.Key_N)
        keyClick(Qt.Key_E)
        keyClick(Qt.Key_W)
        keyClick(Qt.Key_Return)
        compare(PluginService.data.providers.openai.apiKey, "new")
        compare(PluginService.data.apiKey, "new")
        compare(service.sessionApiKey, "")
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
