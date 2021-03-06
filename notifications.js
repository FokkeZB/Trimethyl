/**
 * @class  Notifications
 * @author  Flavio De Stefano <flavio.destefano@caffeinalab.com>
 * Handle notifications system for both platform using Ti.Cloud
 */


/**
 * * **inAppNotification**: Enable the in-app notifications. Default: `true`
 * * **inAppNotificationMethod**: The method of the in-app notification. Must be of of `alert`, `toast`. Default: `toast`
 * * **autoReset**: Check if auto-reset the badge when app is open.
 * @type {Object}
 */
var config = _.extend({
	inAppNotification: true,
	inAppNotificationMethod: 'toast',
	autoReset: true
}, Alloy.CFG.notifications);
exports.config = config;


var Cloud = require("ti.cloud");
Cloud.debug = !ENV_PRODUCTION;

if (OS_ANDROID) {
	var CloudPush = require('ti.cloudpush');
	CloudPush.debug = !ENV_PRODUCTION;
	CloudPush.enabled = true;
	CloudPush.addEventListener('callback', onNotificationReceived);
}

function onNotificationReceived(e) {
	Ti.App.fireEvent('notifications.received', e);

	// reset the badge
	if (config.autoReset) {
		setBadge(0);
	}

	// Handle foreground notifications
	if (!e.inBackground && e.data.alert) {
		if (config.inAppNotification) {

			if (config.inAppNotificationMethod=='toast') {
				require('toast').show(e.data.alert);
			} else if (config.inAppNotificationMethod=='alert') {
				alert(e.data.alert);
			}

		}
	}
}


/**
 * Set the App badge value
 * @param {Number} x
 */
function setBadge(x) {
	if (OS_IOS) {
		Ti.UI.iPhone.setAppBadge(Math.max(x,0));
	} else if (OS_ANDROID) {
		// TODO
	}
}
exports.setBadge = setBadge;


/**
 * Get the App badge value
 * @return {Number}
 */
function getBadge() {
	if (OS_IOS) {
		return Ti.UI.iPhone.getAppBadge();
	} else if (OS_ANDROID) {
		// TODO
	}
}
exports.getBadge = getBadge;

/**
 * Increment the badge app
 * @param  {Number} i The value to increment
 */
function incBadge(i) {
	setBadge(getBadge()+i);
}
exports.incBadge = incBadge;


function cloudSubscribe(channel, deviceToken, callback) {
	Ti.App.Properties.setString('notifications.token', deviceToken);

	Cloud.PushNotifications.subscribeToken({
		device_token: deviceToken,
		channel: channel || 'none',
		type: (function(){
			if (OS_IOS) return 'ios';
			if (OS_ANDROID) return 'gcm';
		})()
	}, function (e) {
		if (!e.success) {
			return Ti.App.fireEvent('notifications.subscription.error', e);
		}

		Ti.App.fireEvent('notifications.subscription.success', { channel: channel });
		if (callback) callback();
	});
}

function subscribeIOS(cb) {
	Ti.Network.registerForPushNotifications({
		types: [ Ti.Network.NOTIFICATION_TYPE_BADGE, Ti.Network.NOTIFICATION_TYPE_ALERT, Ti.Network.NOTIFICATION_TYPE_SOUND ],
		success: function(e){
			if (!e.deviceToken) {
				Ti.App.fireEvent('notifications.subscription.error', e);
				return;
			}

			cb(e.deviceToken);
		},
		error: function(e){
			Ti.App.fireEvent('notifications.subscription.error', e);
		},
		callback: onNotificationReceived
	});
}

function subscribeAndroid(cb) {
	CloudPush.retrieveDeviceToken({
		success: function(e) {
			if (!e.deviceToken) {
				Ti.App.fireEvent('notifications.subscription.error', e);
				return;
			}

			CloudPush.enabled = true;
			cb(e.deviceToken);
		},
		error: function(e) {
			Ti.App.fireEvent('notifications.subscription.error', e);
		}
	});
}

/**
 * Subscribe for that channell
 * @param  {String} channel Channel name
 */
function subscribe(channel) {
	if (OS_IOS) {
		subscribeIOS(function(token){
			cloudSubscribe(channel, token);
		});
	} else if (OS_ANDROID) {
		subscribeAndroid(function(token){
			cloudSubscribe(channel, token);
		});
	}
}
exports.subscribe = subscribe;


function unsubscribeIOS() {
	Ti.Network.unregisterForPushNotifications();
}

function unsubscribeAndroid() {
	CloudPush.enabled = false;
}

function cloudUnsubscribe(channel) {
	var token = Ti.App.Properties.getString('notifications.token');
	if (!token) {
		return;
	}

	Ti.App.Properties.removeProperty('notifications.token');
	Cloud.PushNotifications.unsubscribeToken({
		device_token: token,
		channel: channel || null
	}, function(){
	});
}

/**
 * Unsubscribe for that channell
 * @param  {String} channel Channel name
 */
function unsubscribe(channel) {
	if (OS_IOS) {
		unsubscribeIOS();
	} else if (OS_ANDROID) {
		unsubscribeAndroid();
	}
	cloudUnsubscribe(channel);
}
exports.unsubscribe = unsubscribe;
