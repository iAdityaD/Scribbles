package com.iadityad.scribbles.nearby

import android.app.AlertDialog
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.nearby.Nearby
import com.google.android.gms.nearby.connection.*
import com.google.android.gms.tasks.Task
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/** Bytes only: no media, location data, cloud API key or external server. */
class ScribblesNearbyModule : Module() {
  private val serviceId = "com.iadityad.scribbles.nearby.v1"
  private val client get() = Nearby.getConnectionsClient(requireNotNull(appContext.reactContext))
  private var role = "none"
  private val peers = mutableSetOf<String>()
  private val requested = mutableSetOf<String>()
  private val dialogs = mutableMapOf<String, AlertDialog>()
  private fun event(type: String, vararg fields: Pair<String, Any?>) {
    sendEvent("onNearbyEvent", mapOf("type" to type, *fields))
  }
  private fun complete(task: Task<Void>, promise: Promise) {
    task.addOnSuccessListener { promise.resolve(null) }
      .addOnFailureListener { promise.reject("ERR_NEARBY", it.message ?: "Nearby operation failed", it) }
  }
  private val payloads = object : PayloadCallback() {
    override fun onPayloadReceived(endpointId: String, payload: Payload) {
      if (!peers.contains(endpointId) || payload.type != Payload.Type.BYTES) return
      val bytes = payload.asBytes() ?: return
      if (bytes.size > 32768) { client.disconnectFromEndpoint(endpointId); return }
      event("payload", "endpointId" to endpointId, "data" to bytes.toString(Charsets.UTF_8))
    }
    override fun onPayloadTransferUpdate(endpointId: String, update: PayloadTransferUpdate) {
      if (update.status == PayloadTransferUpdate.Status.FAILURE) {
        event("error", "endpointId" to endpointId, "message" to "Nearby transfer failed. Reconnect to the room.")
      }
    }
  }
  private val lifecycle = object : ConnectionLifecycleCallback() {
    override fun onConnectionInitiated(endpointId: String, info: ConnectionInfo) {
      if (role == "none" || (role == "guest" && !requested.contains(endpointId)) || (role == "host" && peers.size >= 5)) {
        client.rejectConnection(endpointId); return
      }
      peers.add(endpointId)
      val activity = appContext.currentActivity
      if (activity == null) { peers.remove(endpointId); client.rejectConnection(endpointId); return }
      activity.runOnUiThread {
        if (role == "none" || activity.isFinishing) { peers.remove(endpointId); client.rejectConnection(endpointId); return@runOnUiThread }
        dialogs.remove(endpointId)?.dismiss()
        val dialog = AlertDialog.Builder(activity)
          .setTitle("Connect to ${info.endpointName.take(40)}?")
          .setMessage("Check that both phones show ${info.authenticationDigits}. Accept only if the codes match.")
          .setPositiveButton("Codes match") { _, _ ->
            dialogs.remove(endpointId)
            client.acceptConnection(endpointId, payloads).addOnFailureListener {
              peers.remove(endpointId)
              event("error", "endpointId" to endpointId, "message" to (it.message ?: "Could not accept connection"))
            }
          }
          .setNegativeButton("Reject") { _, _ -> dialogs.remove(endpointId); peers.remove(endpointId); client.rejectConnection(endpointId) }
          .setOnCancelListener { dialogs.remove(endpointId); peers.remove(endpointId); client.rejectConnection(endpointId) }
          .create()
        dialogs[endpointId] = dialog
        dialog.show()
      }
    }
    override fun onConnectionResult(endpointId: String, resolution: ConnectionResolution) {
      dialogs.remove(endpointId)?.dismiss()
      if (resolution.status.isSuccess && role != "none") {
        event("connected", "endpointId" to endpointId)
      } else {
        peers.remove(endpointId); requested.remove(endpointId)
        event("disconnected", "endpointId" to endpointId)
      }
    }
    override fun onDisconnected(endpointId: String) {
      peers.remove(endpointId); requested.remove(endpointId)
      dialogs.remove(endpointId)?.dismiss()
      event("disconnected", "endpointId" to endpointId)
    }
  }
  private val discovery = object : EndpointDiscoveryCallback() {
    override fun onEndpointFound(endpointId: String, info: DiscoveredEndpointInfo) {
      if (role == "guest" && info.serviceId == serviceId) event("found", "endpointId" to endpointId, "name" to info.endpointName)
    }
    override fun onEndpointLost(endpointId: String) { event("lost", "endpointId" to endpointId) }
  }
  private fun stop() {
    role = "none"
    client.stopAdvertising(); client.stopDiscovery(); client.stopAllEndpoints()
    peers.clear(); requested.clear()
    val openDialogs = dialogs.values.toList(); dialogs.clear()
    appContext.currentActivity?.runOnUiThread { openDialogs.forEach { it.dismiss() } }
  }
  override fun definition() = ModuleDefinition {
    Name("ScribblesNearby")
    Events("onNearbyEvent")
    AsyncFunction("checkAvailable") { promise: Promise ->
      val context = requireNotNull(appContext.reactContext)
      if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) == ConnectionResult.SUCCESS) promise.resolve(null)
      else promise.reject("ERR_PLAY_SERVICES", "Nearby play needs Google Play services. Install or update it, then try again.", null)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("advertise") { name: String, promise: Promise ->
      stop(); role = "host"
      complete(client.startAdvertising(name.take(80), serviceId, lifecycle,
        AdvertisingOptions.Builder().setStrategy(Strategy.P2P_STAR).build()), promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("discover") { promise: Promise ->
      role = "guest"; client.stopDiscovery()
      complete(client.startDiscovery(serviceId, discovery,
        DiscoveryOptions.Builder().setStrategy(Strategy.P2P_STAR).build()), promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("stopDiscovery") { client.stopDiscovery() }.runOnQueue(Queues.MAIN)
    AsyncFunction("requestConnection") { endpointId: String, name: String, promise: Promise ->
      requested.add(endpointId)
      complete(client.requestConnection(name.take(40), endpointId, lifecycle), promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("send") { endpointId: String, data: String, promise: Promise ->
      val bytes = data.toByteArray(Charsets.UTF_8)
      if (bytes.size > 32768 || !peers.contains(endpointId)) promise.reject("ERR_PAYLOAD", "Invalid Nearby payload or endpoint", null)
      else complete(client.sendPayload(endpointId, Payload.fromBytes(bytes)), promise)
    }.runOnQueue(Queues.MAIN)
    AsyncFunction("disconnectEndpoint") { endpointId: String -> client.disconnectFromEndpoint(endpointId) }.runOnQueue(Queues.MAIN)
    AsyncFunction("stop") { stop() }.runOnQueue(Queues.MAIN)
    OnDestroy { if (appContext.reactContext != null) stop() }
  }
}
