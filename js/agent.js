'use strict';

Object.defineProperty(exports, "__esModule", {
	value: true
});
var debug = require('debug')('tinkerchat:agent');

var authenticate = function authenticate(authenticator) {
	return new Promise(function (resolve, reject) {
		authenticator(function (error, agent) {
			if (error) return reject(error);
			resolve(agent);
		});
	});
};

var onAuthorized = function onAuthorized(_ref) {
	var socket = _ref.socket;
	var customers = _ref.customers;
	return function (agent) {
		// any message sent from a customer needs to be forwarded to the agent socket
		/**
  `message`: A message being sent and the context of the message
   - `id`: the id of the message
   - `chat_id`: the conversation this message is for
   - `timestamp`: timestampe of the message
   - `text`: content of the message
   - `context`: the id of the channel the message was sent to
   - `author_id`: the id of the author of the message
   - `author_type`: One of `customer`, `support`, `agent`
   */
		customers.on('receive', function (message) {
			return socket.emit('message', message);
		});
		socket.on('message', function (message) {
			// TODO: validate message
			customers.emit('send', message);
		});
		socket.emit('init', { agent: agent });
	};
};

var onConnection = function onConnection(_ref2) {
	var authenticator = _ref2.authenticator;
	var customers = _ref2.customers;
	return function (socket) {
		authenticate(authenticator).then(onAuthorized({ socket: socket, customers: customers })).catch(function (e) {
			debug('unauthorized agent', e);
			socket.emit('unauthorized');
			socket.close();
		});
	};
};

exports.default = function (io, _ref3) {
	var customers = _ref3.customers;
	var authenticator = _ref3.authenticator;
	return io.on('connection', onConnection({ authenticator: authenticator, customers: customers }));
};