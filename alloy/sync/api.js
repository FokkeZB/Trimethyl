/*
 * @author  Flavio De Stefano <flavio.destefano@caffeinalab.com>
 * API-Rest Alloy Adapter
 */

var CRUD_TO_REST = {
	'create' : 'POST',
	'read' : 'GET',
	'update' : 'PUT',
	'delete' : 'DELETE'
};

exports.sync = function(method, model, opt) {

	var url = '';
	if (model.config.adapter.baseUrl && model.config.adapter.baseUrl.length>0) {
		url = model.config.adapter.baseUrl;
	} else {
		url = '/';
	}

	url += model.config.adapter.name;

	if (model.id) {
		url += '/' + model.id;
	}

	if (opt.patch) {
		method = 'patch';
	}

	var data = _.extend(opt.netArgs || {}, opt.networkArgs || {}, {
		url: url,
		method: CRUD_TO_REST[method],
		mime: 'json'
	});

	if (Alloy.Backbone.emulateHTTP) {
		if (['DELETE','PUT','PATCH'].indexOf(data.method)!==false) {
			data.headers = _.extend(data.headers || {}, { 'X-HTTP-Method-Override': data.method });
			data.method = 'POST';
		}
	}

	switch (method) {

		case 'create':
		require('net').send(_.extend(data, {
			data: model.toJSON(),
			success: function(resp) {
				if (resp.id) {
					opt.success(resp);
				} else {
					opt.success();
				}

				if (opt.ready) opt.ready();
				model.trigger("fetch");
			},
			error: opt.error
		}));
		break;

		case 'read':
		require('net').send(_.extend(data, {
			data: opt.args || {},
			success: function(resp) {
				opt.success(resp);

				if (opt.ready) opt.ready();
				model.trigger("fetch");
			},
			error: opt.error
		}));
		break;

		case 'update':
		require('net').send(_.extend(data, {
			data: _.pick(model.attributes, _.keys(opt.changes)),
			success: function(resp) {
				if (resp.id) {
					opt.success(resp);
				} else {
					opt.success();
				}

				if (opt.ready) opt.ready();
				model.trigger("fetch");
			},
			error: opt.error
		}));
		break;

		case 'delete':
		require('net').send(_.extend(data, {
			data: opt.args || {},
			success: function(resp) {
				opt.success();

				if (opt.ready) opt.ready();
				model.trigger("fetch");
			},
			error: opt.error
		}));
		break;

	}
};