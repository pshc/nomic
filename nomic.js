var config = require('./config'),
    express = require('express'),
    jsdom = require('jsdom'),
    RedisStore = require('connect-redis'),
    twitter = require('./twitter');

var app = express.createServer();

app.use(express.bodyDecoder());
app.use(express.cookieDecoder());
app.use(express.session({ store: new RedisStore(config.REDIS_OPTIONS),
		secret: config.SESSION_SECRET }));

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
var jquery_js = require('path').join(__dirname, 'lib', 'jquery-1.5.min.js');

DOM.prototype.render = function () {
	var body = this.document.body.innerHTML;
	return '<!doctype html><title>' + this.title + '</title>' + body;
};

function dom_handler(f) {
	return function (req, resp) {
		var dom = new DOM(resp);
		dom.setup(f.bind(dom, req, resp));
	};
}

app.get('/', dom_handler(function (req, resp, $) {
	this.title = 'Nomic';
	var username = req.session.username;
	if (config.DEBUG)
		username = 'test';
	var greeting;
	if (username)
		greeting = 'Hi ' + username + '! ' +
		'<form method="POST" action=".">' +
		'<input type="submit" name="logout" value="Logout"></form>';
	else
		greeting = 'Hi. <a href="login/">Login via Twitter</a>.';
	$('body').append(greeting);
	resp.send(this.render());
}));

app.post('/', function (req, resp) {
	if (req.body.logout) {
		delete req.session.username;
		resp.redirect('.');
	}
	else
		req.next();
});

app.get('/login/', twitter.twitter_login);

app.listen(config.HTTP_PORT);
