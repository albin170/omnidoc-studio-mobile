import Foundation
import Capacitor
import Security

@objc(SecureVaultPlugin)
public class SecureVaultPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SecureVaultPlugin"
    public let jsName = "SecureVault"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "set", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "get", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "remove", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "getSecurityInfo", returnType: CAPPluginReturnPromise),
    ]

    private let serviceName = "studio.omnidoc.mobile.vault"

    @objc func set(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty,
              let value = call.getString("value"),
              let data = value.data(using: .utf8) else {
            call.reject("Missing key or value")
            return
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
        ]

        let existingStatus = SecItemCopyMatching(query as CFDictionary, nil)
        if existingStatus == errSecSuccess {
            let attributes: [String: Any] = [
                kSecValueData as String: data,
                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly,
            ]
            let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
            if status == errSecSuccess {
                call.resolve()
            } else {
                call.reject("Failed to update iOS Keychain item (OSStatus \(status))")
            }
            return
        }

        var addQuery = query
        addQuery[kSecValueData as String] = data
        addQuery[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(addQuery as CFDictionary, nil)
        if status == errSecSuccess {
            call.resolve()
        } else {
            call.reject("Failed to store iOS Keychain item (OSStatus \(status))")
        }
    }

    @objc func get(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Missing key")
            return
        }

        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]

        var item: CFTypeRef?
        let status = SecItemCopyMatching(query as CFDictionary, &item)
        if status == errSecItemNotFound {
            call.resolve(["value": NSNull()])
            return
        }
        guard status == errSecSuccess,
              let data = item as? Data,
              let value = String(data: data, encoding: .utf8) else {
            call.resolve(["value": NSNull()])
            return
        }
        call.resolve(["value": value])
    }

    @objc func remove(_ call: CAPPluginCall) {
        guard let key = call.getString("key"), !key.isEmpty else {
            call.reject("Missing key")
            return
        }
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
            kSecAttrAccount as String: key,
        ]
        SecItemDelete(query as CFDictionary)
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: serviceName,
        ]
        SecItemDelete(query as CFDictionary)
        call.resolve()
    }

    @objc func getSecurityInfo(_ call: CAPPluginCall) {
        call.resolve([
            "storageBackend": "ios_keychain",
            "hardwareBacked": true,
            "securityLevel": "after_first_unlock_this_device_only",
        ])
    }
}
