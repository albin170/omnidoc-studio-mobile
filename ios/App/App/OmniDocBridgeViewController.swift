import UIKit
import Capacitor

class OmniDocBridgeViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        super.capacitorDidLoad()
        bridge?.registerPluginInstance(SecureVaultPlugin())
    }
}
