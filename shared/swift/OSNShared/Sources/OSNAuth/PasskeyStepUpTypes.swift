import Foundation

/// `POST /step-up/passkey/begin` response (`osn/api/src/routes/auth/step-up.ts:39`,
/// `osn/api/src/services/auth/step-up.ts:185-226`) — no request body, Bearer-authed.
public struct StepUpPasskeyBeginResponse: Sendable, Equatable, Decodable {
    public let options: PublicKeyCredentialRequestOptionsJSON
}

/// `POST /step-up/passkey/complete` request body
/// (`osn/api/src/routes/auth/step-up.ts:87-102`). `purpose` is one of the
/// server's literal union; A3 only ever sends `"passkey_delete"` (shared by
/// rename and delete — `osn/api/src/services/auth/step-up.ts:398-400`).
struct StepUpPasskeyCompleteRequestBody: Encodable {
    let assertion: AuthenticationResponseJSON
    let purpose: String?
}

/// `POST /step-up/passkey/complete` success body
/// (`osn/api/src/routes/auth/step-up.ts:73-76`).
public struct StepUpPasskeyCompleteResponse: Sendable, Equatable, Decodable {
    public let stepUpToken: String
    public let expiresIn: Int

    enum CodingKeys: String, CodingKey {
        case stepUpToken = "step_up_token"
        case expiresIn = "expires_in"
    }
}
