import Foundation
import Testing
@testable import OSNKit

// One Keychain item backs the whole store, so these run as ordered steps in
// a single test rather than as separate @Test funcs — Swift Testing runs
// tests concurrently by default, and concurrent saves/deletes against the
// same Keychain item race (duplicate-item and entitlement errors that are
// artifacts of the race, not of the store).
@Test func keychainAccessTokenStoreRoundTrips() throws {
    try KeychainAccessTokenStore.delete()
    #expect(try KeychainAccessTokenStore.load() == nil)

    try KeychainAccessTokenStore.save("token-a")
    #expect(try KeychainAccessTokenStore.load() == "token-a")

    try KeychainAccessTokenStore.save("token-b")
    #expect(try KeychainAccessTokenStore.load() == "token-b")

    try KeychainAccessTokenStore.delete()
    #expect(try KeychainAccessTokenStore.load() == nil)

    try KeychainAccessTokenStore.delete()
    #expect(try KeychainAccessTokenStore.load() == nil)
}
