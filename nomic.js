var config = require('./config'),
    express = require('express'),
    fs = require('fs'),
    jsdom = require('jsdom'),
    path = require('path'),
    twitter = require('./twitter');

var app = express.createServer();

app.use(express.bodyDecoder());
app.use(express.cookieDecoder());
app.use(express.session(config.SESSION_CONFIG));
app.use(express.staticProvider(path.join(__dirname, 'www')));

function DOM(resp) {
	this.resp = resp;
}

DOM.prototype.setup = function (callback) {
	var self = this;
	jsdom.env("<html><body></body></html>", [jquery_js],
			function(errors, window) {
		if (errors) {
			console.error(errors);
			resp.send("Server-side DOM error.", 500);
			return;
		}
		self.$ = window.$;
		self.document = window.document;
		callback.call(self, window.$, window.document);
	});
};
var jquery_js = path.join(__dirname, 'lib', 'jquery-1.5.min.js');

DOM.prototype.render = function () {
	var body = this.document.body.innerHTML;
	return '<!doctype html><title>' + this.title + '</title>' +
		'<link rel="stylesheet" href="style.css">' +
		body;
};

function dom_handler(f) {
	return function (req, resp) {
		var dom = new DOM(resp);
		dom.setup(f.bind(dom, req, resp));
	};
}

app.get('/', dom_handler(function (req, resp, $, document) {
	this.title = 'Nomic';
	var username = req.session.username;
	var button = $('<input type="submit"/>');
	var form = $('<form method="POST"/>').append(button).appendTo('body');
	if (username) {
		form.prepend('Hi ' + username + '! ');
		button.attr('name', 'logout').attr('value', 'Logout');
		form.attr('action', '.');
	}
	else {
		button.attr('value', 'Login via Twitter');
		form.attr('action', 'login/');
	}
	var self = this;
	fs.readFile('rules.txt', 'UTF-8', function (err, rules) {
		if (err)
			throw err;
		var ul = $('<ul/>').appendTo('body');
		rules.split('\n').forEach(function (rule) {
			var li = $('<li/>');
			var m = rule.match(/^\s*(\d+)\.(.*)/);
			if (m) {
				rule = m[2];
				li.attr('id', m[1])
				li.append('<a class="rule" href="#' + m[1] + '">' + m[1] + '</a>.');
			}
			if (rule.match(/^\*.*\*$/))
				rule = $('<b/>').text(rule.slice(1, -1));
			else
				rule = document.createTextNode(rule);
			li.append(rule).appendTo(ul);
		});
		resp.send(self.render());
	});
}));

app.post('/', function (req, resp) {
	if (req.body.logout) {
		delete req.session.username;
		resp.redirect('.');
	}
	else
		req.next();
});

if (config.DEBUG)
	app.post('/login/', function (req, resp) {
		req.session.username = 'test';
		resp.redirect('..');
	});
else {
	app.get('/login/', twitter.twitter_login);
	app.post('/login/', twitter.twitter_login);
}

app.listen(config.HTTP_PORT);
