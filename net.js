/**
 * @class  Net
 * @author  Flavio De Stefano <flavio.destefano@caffeinalab.com>
 * Network module
 */

/**
 * * **base**: The base URL of the API
 * * **timeout**: Global timeout for the requests. After this value (express in seconds) the requests throw an error. Default: `http://localhost`
 * * **useCache**: Check if the requests are automatically cached. Default: `true`
 * * **headers**: Global headers for all requests. Default: `{}`
 * * **debug**: Enable ultra verbose logging. Default: `true`
 * * **usePingServer**: Enable the PING-Server support. Default: `true`
 * @type {Object}
 */
var config = _.extend({
	base: 'http://localhost',
	timeout: 10000,
	useCache: true,
	headers: {},
	debug: false,
	usePingServer: true
}, Alloy.CFG.net);
exports.config = config;

var NetCache = null;

var queue = {};
var serverConnected = null;
var errorHandler = null;

function originalErrorHandler(e) { require('util').alertError(e.message); }
errorHandler = originalErrorHandler;

function calculateHash(request) {
	return Ti.Utils.md5HexDigest(request.url+JSON.stringify(request.data||{})+JSON.stringify(request.headers||{}));
}

function setApplicationInfo(appInfo) {
	_.each(appInfo, function(v,k){
		Ti.App.Properties.setString('settings.'+k, v);
	});
}

/**
 * Set a new global handler for the errors
 * @param {Function} fun The new function
 */
function setErrorHandler(fun) {
	errorHandler = fun;
}
exports.setErrorHandler = setErrorHandler;


/**
 * Reset the original error handler
 */
function resetErrorHandler(){
	errorHandler = originalErrorHandler;
}
exports.resetErrorHandler = resetErrorHandler;


function getResponseInfo(response) {
	var info = {};

	// Check first the Content-Type
	var contentType = response.getResponseHeader('Content-Type');
	if (contentType=='application/json') {
		info.mime = 'json';
	}

	// Check the Expires header
	var expires = response.getResponseHeader('Expires');
	if (expires) {
		var t = require('util').timestamp(expires);
		if (t) info.expire = t;
	}

	// Check againts X-Cache-Ttl header (in seconds)
	var ttl = response.getResponseHeader('X-Cache-Ttl');
	if (ttl) {
		info.expire = require('util').timestamp( 1000*(require('util').timestamp()+parseInt(ttl,10)) );
	}

	return info;
}


function decorateRequest(request) {
	if (request.hash) {
		// yet decorated
		return request;
	}

	if (!request.url) request.url = '/';

	// if the url is not matching :// (a protocol), assign the base URL
	if (!request.url.match(/\:\/\//)) {
		request.url = config.base.replace(/\/$/,'') + '/' + request.url.replace(/^\//, '');
	}

	request.method = request.method ? request.method.toUpperCase() : 'GET';
	request.headers = _.extend(config.headers, request.headers || {});
	if (!request.timeout) request.timeout = config.timeout;

	if (!request.success) request.success = function(){};
	if (!request.error) request.error = errorHandler;

	// Rebuild the URL if is a GET and there's data
	if (request.method=='GET' && request.data) {
		var buildedQuery = require('util').buildQuery(request.data);
		delete request.data;
		request.url = request.url + buildedQuery.toString();
	}

	request.hash = calculateHash(request);
	return request;
}


function onComplete(request, response, e){
	// Delete request from queue
	delete queue[request.hash];

	// Fire the global event
	if (!request.silent) {
		Ti.App.fireEvent('net.end', {
			id: request.hash,
			eventName: request.eventName || null
		});
	}

	if (request.complete) {
		request.complete();
	}

	// Get the response information
	var info = getResponseInfo(response);

	// Override response info
	if (request.mime) info.mime = request.mime;
	if (request.expire) info.expire = request.expire;

	if (ENV_DEVELOPMENT && config.debug) {
		Ti.API.debug("Net: response informations are "+JSON.stringify(info));
	}

	var returnValue = null;
	var returnError = null;

	// Parse based on response info
	if (info.mime=='json') {
		returnValue = require('util').parseJSON(response.responseText);
	} else {
		returnValue = response.responseData;
	}

	if (e.success) {

		/*
		SUCCESS
		*/

		if (ENV_DEVELOPMENT && config.debug) {
			Ti.API.debug("Net: response success");
		}

		// Write cache
		if (NetCache && request.cache!==false && request.method=='GET' && info.expire>0) {
			NetCache.set(request, response, info);
		}

		// Success callback
		request.success(returnValue);
		return true;

	} else {

		/*
		ERROR
		*/

		if (ENV_DEVELOPMENT && config.debug) {
			Ti.API.error("Net: error -> "+JSON.stringify(response));
		}

		// Parse the error returned from the server
		if (returnValue && returnValue.error) {
			returnError = returnValue.error.message ? returnValue.error.message : returnValue.error;
		} else {
			returnError = L('net_error');
		}

		// Build the error
		var E = {
			message: returnError,
			code: response.status
		};

		// Error callback
		request.error(E);
		return false;

	}
}


/**
 * Check the internet connectivity
 * @return {Boolean} The status
 */
function isOnline() {
	return Ti.Network.online;
}
exports.isOnline = isOnline;


/**
 * Add a global header for all requests
 * @param {String} key 		The header key
 * @param {String} value 	The header value
 */
function addHeader(key, value) {
	config.headers[key] = value;
}
exports.addHeader = addHeader;


/**
 * Remove a global header
 * @param {String} key 		The header key
 */
function removeHeader(key) {
	delete config.headers[key];
}
exports.removeHeader = removeHeader;


/**
 * Reset all globals headers
 */
function resetHeaders() {
	config.headers = {};
}
exports.resetHeaders = resetHeaders;


/**
 * When using a PING-Server, check if the connection has been estabilished
 * @return {Boolean}
 */
function isServerConnected(){
	return serverConnected;
}
exports.isServerConnected = isServerConnected;


/**
 * Return the value of config.usePingServer
 * @return {Boolean}
 */
function usePingServer(){
	return config.usePingServer;
}
exports.usePingServer = usePingServer;


/**
 * Connect to the PING-Server
 *
 * This method also set the properties for **settings.{X}**
 *
 * Fire a *net.ping.success* on success
 *
 * Fire a *net.ping.error* on error
 *
 * @param  {Function} cb The success callback
 */
function connectToServer(cb) {
	return send({
		url: '/ping',
		method: 'POST',
		silent: true,
		success: function(appInfo){
			serverConnected = true;
			setApplicationInfo(appInfo);
			Ti.App.fireEvent('net.ping.success');
			if (cb) cb(true);
		},
		error: function(message, response){
			serverConnected = false;
			Ti.App.fireEvent('net.ping.error');
			if (cb) cb(false);
		}
	});
}
exports.connectToServer = connectToServer;


/**
 * Check if the requests queue is empty
 * @return {Boolean}
 */
function isQueueEmpty(){
	return !queue.length;
}
exports.isQueueEmpty = isQueueEmpty;


/**
 * Get the current requests queue
 * @return {Array}
 */
function getQueue(){
	return queue;
}
exports.getQueue = getQueue;


/**
 * Get the request identified by the hash in the queued requests
 *
 * If a complete request object is passed, the hash is calculated
 *
 * @param  {String|Object} hash The hash or the request
 * @return {Ti.Network.HTTPClient}
 */
function getQueuedRequest(hash) {
	if (_.isObject(hash)) hash = decorateRequest(hash).hash;
	return queue[hash];
}
exports.getQueuedRequest = getQueuedRequest;


/**
 * Abort the request identified by the hash in the queued requests
 *
 *  If a complete request object is passed, the hash is calculated
 *
 * @param  {String|Object} hash The hash or the request
 */
function abortRequest(hash) {
	var httpClient = getQueuedRequest(hash);
	if (!httpClient) return;
	try {
		httpClient.abort();
		Ti.API.debug("Net: request aborted");
	} catch (e) {
		Ti.API.error("Net: aborting request error, "+e);
	}
}
exports.abortRequest = abortRequest;


/**
 * @method resetCache
 * Alias for @{@link #net.cache.reset}
 */
exports.resetCache = function(){
	if (!NetCache) return;
	NetCache.reset();
};


/**
 * Reset the cookies for all requests
 */
function resetCookies() {
	// TODO
}
exports.resetCookies = resetCookies;


/**
 * Delete the cache entry for the passed request
 *
 * If a complete request object is passed, the hash is calculated
 *
 * @param  {String|Object} request [description]
 */
exports.deleteCache = function(hash) {
	if (!NetCache) return;
	if (_.isObject(hash)) hash = decorateRequest(hash).hash;
	NetCache.del(hash);
};


/**
 * The main function of the module, create the HTTPClient and make the request
 *
 *	There are various options to pass:
 *
 * * **url**: The endpoint URL
 * * **method**: The HTTP method to use (GET|POST|PUT|PATCH|..)
 * * **headers**: An Object key-value of additional headers
 * * **timeout**: Timeout after stopping the request and triggering an error
 * * **cache**: Set to false to disable the cache
 * * **success**: The success callback
 * * **error**: The error callback
 * * **mime**: Override the mime for that request (like `json`)
 * * **expire**: Override the TTL seconds for the cache
 *
 * @param  {Object} request The request dictionary
 * @return {String}	The hash to identify this request
 */
function send(request) {
	request = decorateRequest(request);

	if (ENV_DEVELOPMENT && config.debug) {
		Ti.API.debug("Net: making request -> "+JSON.stringify(request));
	}

	// Try to get the cache, otherwise make the HTTP request
	if (NetCache && request.cache!==false && request.method=='GET') {

		var cache = NetCache.get(request, !Ti.Network.online);
		if (cache) {

			// if we are offline, but we got cache, fire event to handle
			if (!Ti.Network.online) {
				Ti.App.fireEvent('net.offline', {
					cache: true
				});
			}

			if (request.complete) {
				request.complete();
			}

			if (ENV_DEVELOPMENT && config.debug) {
				Ti.API.debug("Net: success from cache");
			}

			request.success(cache);
			return request.hash;
		}
	}

	// If we aren't online and we are here, we can't proceed, so STOP!
	if (!isOnline()) {
		Ti.App.fireEvent('net.offline', { cache: false });
		require('util').alert(L('net_offline_title'), L('net_offline_message'));
		return false;
	}

	var H = Ti.Network.createHTTPClient();

	if (!request.silent) {
		Ti.App.fireEvent('net.start', {
			id: request.hash,
			eventName: request.eventName || null
		});
	}

	// Add this request to the queue
	queue[request.hash] = H;
	H.timeout = request.timeout;
	H.cache = false;

	// onLoad && onError are the same because we have an internal parser that discern the event.success property; WOW!
	H.onload = H.onerror = function(e){ onComplete(request, this, e); };
	H.open(request.method, request.url);

	// Set the headers
	_.each(request.headers, function(h, k) {
		H.setRequestHeader(k, h);
	});

	// Finally, send the request
	if (request.data) {
		H.send(request.data);
	} else {
		H.send();
	}

	// And return the hash of this request
	return request.hash;
}
exports.send = send;


/**
 * @method get
 * Make a GET request to that URL
 * @param  {String}   	url The endpoint url
 * @param  {Function} 	success  Success callback
 * @param  {Function} 	error Error callback
 * @return {String}		The hash
 */
exports.get = function(url, success, error) {
	return send({
		url: url,
		method: 'GET',
		success: success,
		error: error
	});
};


/**
 * @method post
 * Make a POST request to that URL
 * @param  {String}   	url The endpoint url
 * @param  {Object}   	data The data
 * @param  {Function} 	success  Success callback
 * @param  {Function} 	error Error callback
 * @return {String}		The hash
 */
exports.post = function(url, data, success, error) {
	return send({
		url: url,
		method: 'POST',
		data: data,
		success: success,
		error: error
	});
};

/**
 * @method  getJSON
 * Make a GET request to that url with that data and setting the mime forced to JSON
 * @param  {String}   	url 	The endpoint url
 * @param  {Object}   	data 	The data
 * @param  {Function} 	success  Success callback
 * @param  {Function} 	error Error callback
 * @return {String}		The hash
 */
exports.getJSON = function(url, data, success, error) {
	return send({
		url: url,
		data: data,
		method: 'GET',
		mime: 'json',
		success: success,
		error: error
	});
};

/**
 * @method  postJSON
 * Make a POST request to that url with that data and setting the mime forced to JSON
 * @param  {String}   	url 	The endpoint url
 * @param  {Object}   	data 	The data
 * @param  {Function} 	success  Success callback
 * @param  {Function} 	error Error callback
 * @return {String}		The hash
 */
exports.postJSON = function(url, data, success, error) {
	return send({
		url: url,
		data: data,
		method: 'POST',
		mime: 'json',
		success: success,
		error: error
	});
};


(function init(){

	if (config.useCache) {
		NetCache = require('net.cache');
	}

})();
