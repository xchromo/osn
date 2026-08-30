import Foundation

/// The one place that decides when a stored access token is too near expiry
/// to send, and the one path that fetches a fresh one.
///
/// Both authenticated request paths in this package resolve their bearer
/// token here — `AuthenticatedTransport` behind the `OSNAuth` clients, and
/// `BearerTokenMiddleware` in front of the generated Pulse client — so the
/// skew allowance is written once instead of once per path, and each path
/// performs exactly one Keychain read per request.
///
/// Nothing is cached in memory, deliberately. The Keychain item is the only
/// copy: a token held in a property outlives the item it came from, and a
/// sibling app rotating that item to a different user's token is the S-H1
/// bug class that `OSNSession.reconcileIdentity()` exists to close.
public struct AccessTokenProvider: Sendable {
    /// A stored token within this many seconds of its `expiresAt` counts as
    /// already gone, so one is never sent moments before the server would
    /// reject it mid-flight. Access tokens live five minutes
    /// (`wiki/systems/identity-model.md`), so this is a clock-skew
    /// allowance, not a refresh schedule.
    public static let expirySkew: TimeInterval = 30

    private let tokenRefresher: TokenRefresher

    public init(tokenRefresher: TokenRefresher) {
        self.tokenRefresher = tokenRefresher
    }

    /// The bearer token for one outgoing request, from exactly one Keychain
    /// read, treating an empty Keychain as a cold start: nothing is stored
    /// yet, but the session cookie may well be good, so refresh and carry
    /// on. `BearerTokenMiddleware`'s case — the Pulse client is built once at
    /// launch and its first call routinely mints the process's first access
    /// token.
    public func bearerTokenRefreshingWhenAbsent() async throws -> String {
        guard let stored = try KeychainAccessTokenStore.load() else {
            return try await tokenRefresher.refresh().accessToken
        }
        return try await token(replacing: stored)
    }

    /// The same single read, treating an empty Keychain as the signed-out
    /// state: `nil`, rather than a `/token` round trip with no session
    /// cookie to present. The `OSNAuth` clients' case, which surface it as
    /// `OSNAuthError.accessTokenMissing`.
    ///
    /// A token that *is* stored but sits within `expirySkew` of expiry is
    /// refreshed on this path too — being signed out and holding a stale
    /// token are different states and only the first is reported.
    public func storedSessionBearerToken() async throws -> String? {
        guard let stored = try KeychainAccessTokenStore.load() else { return nil }
        return try await token(replacing: stored)
    }

    /// The 401 path: refresh unconditionally and return the new token.
    ///
    /// Deliberately reads no Keychain first — whatever is stored is exactly
    /// what the server just rejected. `TokenRefresher.refresh()` already
    /// coalesces concurrent callers onto a single `/token` request, so
    /// several requests failing at once still rotate the session cookie
    /// once; a second coalescer here would reintroduce the replayed-cookie
    /// reuse detection that PR #289 fixed on the web client.
    public func refreshedBearerToken() async throws -> String {
        try await tokenRefresher.refresh().accessToken
    }

    private func token(replacing stored: KeychainAccessTokenStore.StoredAccessToken) async throws -> String {
        if stored.expiresAt.timeIntervalSinceNow > Self.expirySkew {
            return stored.token
        }
        return try await tokenRefresher.refresh().accessToken
    }
}
