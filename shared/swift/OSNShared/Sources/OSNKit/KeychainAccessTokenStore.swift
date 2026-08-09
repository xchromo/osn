import Foundation
import Security

/// Stores the access token only — never the session cookie value, which
/// stays HttpOnly and lives in `SharedCookieJar`'s cookie storage. One item,
/// overwritten on every refresh; there's exactly one "current" access token
/// per app process, so no per-environment or per-account keying.
public enum KeychainAccessTokenStore {
    private static let service = "OSNKit.accessToken"
    private static let account = "current"

    /// Overwrites any existing stored token.
    public static func save(_ token: String) throws {
        SecItemDelete(baseQuery() as CFDictionary)
        var query = baseQuery()
        query[kSecValueData as String] = Data(token.utf8)
        query[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let status = SecItemAdd(query as CFDictionary, nil)
        guard status == errSecSuccess else {
            throw OSNKitError.keychainWriteFailed(status: status)
        }
    }

    /// `nil` when no token is stored — that's a normal state (signed out),
    /// not an error.
    public static func load() throws -> String? {
        var query = baseQuery()
        query[kSecReturnData as String] = true
        query[kSecMatchLimit as String] = kSecMatchLimitOne
        var result: AnyObject?
        let status = SecItemCopyMatching(query as CFDictionary, &result)
        switch status {
        case errSecSuccess:
            guard let data = result as? Data, let token = String(data: data, encoding: .utf8) else {
                throw OSNKitError.keychainReadFailed(status: status)
            }
            return token
        case errSecItemNotFound:
            return nil
        default:
            throw OSNKitError.keychainReadFailed(status: status)
        }
    }

    public static func delete() throws {
        let status = SecItemDelete(baseQuery() as CFDictionary)
        guard status == errSecSuccess || status == errSecItemNotFound else {
            throw OSNKitError.keychainDeleteFailed(status: status)
        }
    }

    private static func baseQuery() -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
    }
}
