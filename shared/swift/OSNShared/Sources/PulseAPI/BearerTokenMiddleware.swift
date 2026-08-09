import Foundation
import HTTPTypes
import OpenAPIRuntime
import OSNKit

/// Injects the OSN access token into every outgoing Pulse request. Uses the
/// cached Keychain token when present; falls back to `TokenRefresher` when
/// none is cached, so the first call after launch still authenticates.
public struct BearerTokenMiddleware: ClientMiddleware {
    private let tokenRefresher: TokenRefresher

    public init(tokenRefresher: TokenRefresher) {
        self.tokenRefresher = tokenRefresher
    }

    public func intercept(
        _ request: HTTPRequest,
        body: HTTPBody?,
        baseURL: URL,
        operationID: String,
        next: @Sendable (HTTPRequest, HTTPBody?, URL) async throws -> (HTTPResponse, HTTPBody?)
    ) async throws -> (HTTPResponse, HTTPBody?) {
        var request = request
        let token: String
        if let cached = try KeychainAccessTokenStore.load() {
            token = cached
        } else {
            token = try await tokenRefresher.refresh().accessToken
        }
        request.headerFields[.authorization] = "Bearer \(token)"
        return try await next(request, body, baseURL)
    }
}
