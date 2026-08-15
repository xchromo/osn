import OSNAuth
import OSNAuthUI
import SwiftUI

/// App shell root: gates on `OSNSession.state` directly — Musubi has no
/// feature-specific session wrapper, nothing to add on top of sign-in.
/// Construct once per app launch and pass the iOS anchor provider in from
/// `App.swift` (this package can't import UIKit).
public struct MusubiRootView: View {
    private let session: OSNSession
    private let anchorProvider: PresentationAnchorProvider

    public init(session: OSNSession, anchorProvider: @escaping PresentationAnchorProvider) {
        self.session = session
        self.anchorProvider = anchorProvider
    }

    public var body: some View {
        content
            .task {
                if session.state == .restoring {
                    await session.restore()
                }
            }
    }

    @ViewBuilder
    private var content: some View {
        switch session.state {
        case .restoring:
            ProgressView()
        case .signedOut, .failed:
            PasskeySignInView(appName: "Musubi", session: session, anchorProvider: anchorProvider)
        case .signedIn:
            MusubiAccountView(session: session)
        }
    }
}
