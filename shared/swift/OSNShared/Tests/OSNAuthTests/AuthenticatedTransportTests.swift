import Foundation
import OSNKit
import OSNTesting
import Testing

@testable import OSNAuth

/// `MockURLProtocol.handler` is `@Sendable`, so a plain captured `var` is a
/// data race under strict concurrency even where every call is sequential.
/// Same shape as `PulseAPITests`' recorder.
private actor Recorder<Value: Sendable> {
    private(set) var values: [Value] = []
    func record(_ value: Value) { values.append(value) }
    var count: Int { values.count }
    var last: Value? { values.last }
}

/// One recorded request, reduced to the two headers this suite asserts on.
private struct SeenRequest: Sendable, Equatable {
    let path: String
    let authorization: String?
    let stepUpToken: String?
}

private func record(_ request: URLRequest, into recorder: Recorder<SeenRequest>) async {
    await recorder.record(
        SeenRequest(
            path: request.url?.path ?? "",
            authorization: request.value(forHTTPHeaderField: "Authorization"),
            stepUpToken: request.value(forHTTPHeaderField: "X-Step-Up-Token")
        )
    )
}

private let tokenGrantBody = #"""
{"access_token":"rotated-token","token_type":"Bearer","expires_in":300,"scope":"openid profile"}
"""#

private func tokenGrantResponse() -> (Int, [String: String], Data) {
    (
        200,
        ["Content-Type": "application/json", "Set-Cookie": "osn_session=rotated-1; Path=/"],
        Data(tokenGrantBody.utf8)
    )
}

private let passkeyListBody = #"""
{"passkeys":[{"id":"pk_0123456789ab","label":"iPhone","aaguid":null,"transports":null,
 "backupEligible":null,"backupState":null,"createdAt":1,"lastUsedAt":null}]}
"""#

/// The 401-retry, the single Keychain read and the shared skew allowance, all
/// driven through a real client rather than the transport directly — the point
/// of the change is that every `OSNAuth` client gets this without asking, and a
/// test that reached past them could not show that.
///
/// Touches the real Keychain, so it carries `.keychainSerializing` like every
/// other suite that drives `MockURLProtocol` — see that type's doc.
@Suite(.serialized, .keychainSerializing)
struct AuthenticatedTransportTests {
    @Test func aRejectedAccessTokenIsRefreshedAndTheRequestRetriedOnce() async throws {
        try KeychainAccessTokenStore.delete()
        try KeychainAccessTokenStore.save("looks-fresh", expiresIn: 300)

        let environment = Environment.local
        let session = makeMockSession()
        let client = PasskeyManagementClient(
            session: session,
            environment: environment,
            tokenRefresher: TokenRefresher(session: session, environment: environment)
        )

        let seen = Recorder<SeenRequest>()
        MockURLProtocol.handler = { request in
            await record(request, into: seen)
            let path = request.url?.path ?? ""
            if path.hasSuffix("/token") {
                return tokenGrantResponse()
            }
            let attempts = await seen.values.filter { $0.path.hasSuffix("/passkeys") }.count
            if attempts == 1 {
                return (401, ["Content-Type": "application/json"], Data(#"{"error":"unauthorized"}"#.utf8))
            }
            return (200, ["Content-Type": "application/json"], Data(passkeyListBody.utf8))
        }

        let passkeys = try await client.list()

        #expect(passkeys.map(\.id) == ["pk_0123456789ab"])
        #expect(
            await seen.values.map(\.path) == ["/passkeys", "/token", "/passkeys"],
            "a 401 refreshes once, then replays the same request"
        )
        #expect(await seen.values.map(\.authorization) == [
            "Bearer looks-fresh", nil, "Bearer rotated-token",
        ])
        #expect(try KeychainAccessTokenStore.load()?.token == "rotated-token")

        try KeychainAccessTokenStore.delete()
    }

    @Test func aSecondUnauthorizedIsReportedRatherThanRetriedAgain() async throws {
        try KeychainAccessTokenStore.delete()
        try KeychainAccessTokenStore.save("looks-fresh", expiresIn: 300)

        let environment = Environment.local
        let session = makeMockSession()
        let client = PasskeyManagementClient(
            session: session,
            environment: environment,
            tokenRefresher: TokenRefresher(session: session, environment: environment)
        )

        let seen = Recorder<SeenRequest>()
        MockURLProtocol.handler = { request in
            await record(request, into: seen)
            if request.url?.path.hasSuffix("/token") == true {
                return tokenGrantResponse()
            }
            return (401, ["Content-Type": "application/json"], Data(#"{"error":"unauthorized"}"#.utf8))
        }

        await #expect(throws: OSNAuthError.requestFailed(status: 401, error: "unauthorized")) {
            _ = try await client.list()
        }
        #expect(
            await seen.values.map(\.path) == ["/passkeys", "/token", "/passkeys"],
            "exactly one retry — `TokenRefresher` is the only thing that can mint a token and it has had its turn"
        )

        try KeychainAccessTokenStore.delete()
    }

    /// The retry resends the single-use `X-Step-Up-Token`, which is only safe
    /// because the server resolves the bearer principal and 401s *before* it
    /// verifies step-up (`osn/api/src/routes/auth/passkey-management.ts:140`),
    /// so the first attempt never consumed the token's jti.
    @Test func theStepUpTokenIsResentUnchangedOnTheRetry() async throws {
        try KeychainAccessTokenStore.delete()
        try KeychainAccessTokenStore.save("looks-fresh", expiresIn: 300)

        let environment = Environment.local
        let session = makeMockSession()
        let client = PasskeyManagementClient(
            session: session,
            environment: environment,
            tokenRefresher: TokenRefresher(session: session, environment: environment)
        )

        let seen = Recorder<SeenRequest>()
        MockURLProtocol.handler = { request in
            await record(request, into: seen)
            let path = request.url?.path ?? ""
            if path.hasSuffix("/token") {
                return tokenGrantResponse()
            }
            let attempts = await seen.values.filter { $0.path.contains("pk_") }.count
            if attempts == 1 {
                return (401, ["Content-Type": "application/json"], Data(#"{"error":"unauthorized"}"#.utf8))
            }
            return (
                200,
                ["Content-Type": "application/json"],
                Data(#"{"success":true,"remaining":2}"#.utf8)
            )
        }

        let result = try await client.delete(id: "pk_0123456789ab", stepUpToken: "step-up-1")

        #expect(result == PasskeyDeleteResult(success: true, remaining: 2))
        #expect(await seen.values.compactMap(\.stepUpToken) == ["step-up-1", "step-up-1"])

        try KeychainAccessTokenStore.delete()
    }

    @Test func nothingStoredIsReportedWithoutSendingARequest() async throws {
        try KeychainAccessTokenStore.delete()

        let environment = Environment.local
        let session = makeMockSession()
        let client = PasskeyManagementClient(
            session: session,
            environment: environment,
            tokenRefresher: TokenRefresher(session: session, environment: environment)
        )

        let seen = Recorder<SeenRequest>()
        MockURLProtocol.handler = { request in
            await record(request, into: seen)
            return (200, [:], Data())
        }

        await #expect(throws: OSNAuthError.accessTokenMissing) {
            _ = try await client.list()
        }
        #expect(
            await seen.count == 0,
            "signed out is not a cold start: no `/token` round trip with no session cookie to spend"
        )
    }

    /// The other half of the fix: a stored token inside the skew allowance is
    /// replaced *before* the request, so the 401 path is a backstop rather than
    /// the normal way an expiring token gets renewed. `expirySkew` is 30s and
    /// lives in one place now — `BearerTokenMiddleware` reads the same value.
    @Test func aTokenInsideTheSkewAllowanceIsRefreshedBeforeTheRequest() async throws {
        try KeychainAccessTokenStore.delete()
        try KeychainAccessTokenStore.save(
            "about-to-expire",
            expiresIn: AccessTokenProvider.expirySkew - 5
        )

        let environment = Environment.local
        let session = makeMockSession()
        let client = PasskeyManagementClient(
            session: session,
            environment: environment,
            tokenRefresher: TokenRefresher(session: session, environment: environment)
        )

        let seen = Recorder<SeenRequest>()
        MockURLProtocol.handler = { request in
            await record(request, into: seen)
            if request.url?.path.hasSuffix("/token") == true {
                return tokenGrantResponse()
            }
            return (200, ["Content-Type": "application/json"], Data(passkeyListBody.utf8))
        }

        _ = try await client.list()

        #expect(await seen.values.map(\.path) == ["/token", "/passkeys"])
        #expect(await seen.last?.authorization == "Bearer rotated-token")

        try KeychainAccessTokenStore.delete()
    }
}
