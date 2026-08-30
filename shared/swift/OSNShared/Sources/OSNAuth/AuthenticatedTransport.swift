import Foundation
import OSNKit

/// The single path every Bearer-authenticated `OSNAuth` request takes.
///
/// Each client used to repeat the same five steps — build the request, paste
/// on whatever token the Keychain held, send it, check the status, decode —
/// and the paste step had no expiry check and no retry. A screen left open
/// past the access token's five-minute TTL (`wiki/systems/identity-model.md`)
/// therefore just failed, and every new call site had to remember to call
/// `OSNSession.ensureFreshAccessToken()` first; forgetting was silent.
///
/// Retrying a 401 is safe on every route these clients call, including the
/// three that carry a single-use `X-Step-Up-Token`. Each route resolves the
/// bearer principal and returns 401 *before* it verifies the step-up token
/// (`osn/api/src/routes/auth/passkey-management.ts:81` and `:140`,
/// `passkey-enroll.ts:46`), so a request rejected for a stale access token
/// has not consumed its step-up jti and the same step-up token is still good
/// on the retry.
///
/// Non-isolated, so the remaining Keychain read happens on the cooperative
/// pool even when the caller is `@MainActor`: `SecItemCopyMatching` is a
/// synchronous IPC to `securityd`, and on the main actor that is a hitch.
struct AuthenticatedTransport: Sendable {
    private let session: URLSession
    private let tokens: AccessTokenProvider

    init(session: URLSession, tokenRefresher: TokenRefresher) {
        self.session = session
        self.tokens = AccessTokenProvider(tokenRefresher: tokenRefresher)
    }

    /// Sends `request` with a bearer token resolved from one Keychain read
    /// and returns the 200 body.
    ///
    /// On a 401 — the server rejected a token that looked fresh here, which
    /// is what a clock difference or a sibling app's sign-out produces — it
    /// refreshes once and sends the request again. A second 401 is reported,
    /// never retried: `TokenRefresher` is the only thing that can mint a
    /// token, and it has already had its turn.
    ///
    /// Throws `.accessTokenMissing` rather than sending an unauthenticated
    /// request that the server would 401 anyway.
    func data(for request: URLRequest) async throws -> Data {
        guard let token = try await tokens.storedSessionBearerToken() else {
            throw OSNAuthError.accessTokenMissing
        }
        var request = request
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")

        let (data, response) = try await session.data(for: request)
        let http = try Self.httpResponse(response)
        guard http.statusCode == 401, Self.isReplayable(request) else {
            return try Self.body(data, http)
        }

        let freshToken = try await tokens.refreshedBearerToken()
        request.setValue("Bearer \(freshToken)", forHTTPHeaderField: "Authorization")
        let (retryData, retryResponse) = try await session.data(for: request)
        let retryHTTP = try Self.httpResponse(retryResponse)
        return try Self.body(retryData, retryHTTP)
    }

    /// `data(for:)` plus the decode every caller does with the result. A 200
    /// that doesn't decode is `.responseMalformed`, not a request failure —
    /// the call reached the server and the server agreed to it.
    func decode<T: Decodable>(_ type: T.Type, from request: URLRequest) async throws -> T {
        let data = try await data(for: request)
        guard let decoded = try? JSONDecoder().decode(type, from: data) else {
            throw OSNAuthError.responseMalformed(status: 200)
        }
        return decoded
    }

    /// A body already streamed to the server cannot be sent a second time,
    /// so a request carrying one gets its 401 handed back instead of a retry
    /// that would send nothing. Every request these clients build sets
    /// `httpBody` — plain `Data`, replayable — or carries no body at all;
    /// the guard is for the hand-built request that doesn't.
    private static func isReplayable(_ request: URLRequest) -> Bool {
        request.httpBodyStream == nil
    }

    private static func body(_ data: Data, _ http: HTTPURLResponse) throws -> Data {
        guard http.statusCode == 200 else {
            throw RequestHelpers.opaqueFailure(status: http.statusCode, data: data)
        }
        return data
    }

    private static func httpResponse(_ response: URLResponse) throws -> HTTPURLResponse {
        guard let http = response as? HTTPURLResponse else {
            throw OSNAuthError.responseMalformed(status: -1)
        }
        return http
    }
}
