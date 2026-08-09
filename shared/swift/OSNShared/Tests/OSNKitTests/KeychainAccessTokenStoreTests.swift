import Foundation
import Testing
@testable import OSNKit

// One Keychain item backs the whole store, so every test that touches it —
// here and in TokenRefresherTests.swift — runs as an ordered step inside
// this one serialized suite rather than as independent @Test funcs. Swift
// Testing runs tests concurrently by default, and concurrent saves/deletes
// against the same Keychain item race (duplicate-item and entitlement
// errors that are artifacts of the race, not of the store).
@Suite(.serialized)
struct KeychainSerialTests {
    @Test func keychainAccessTokenStoreRoundTrips() throws {
        try KeychainAccessTokenStore.delete()
        #expect(try KeychainAccessTokenStore.load() == nil)

        try KeychainAccessTokenStore.save("token-a", expiresIn: 300)
        let stored = try KeychainAccessTokenStore.load()
        #expect(stored?.token == "token-a")
        #expect(stored?.expiresAt.timeIntervalSinceNow ?? 0 > 250)

        try KeychainAccessTokenStore.save("token-b", expiresIn: 60)
        #expect(try KeychainAccessTokenStore.load()?.token == "token-b")

        try KeychainAccessTokenStore.delete()
        #expect(try KeychainAccessTokenStore.load() == nil)

        try KeychainAccessTokenStore.delete()
        #expect(try KeychainAccessTokenStore.load() == nil)
    }
}
