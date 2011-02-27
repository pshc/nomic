var config = require('./config'),
    express = require('express'),
    fs = require('fs'),
    io = require('socket.io'),
    jsdom = require('jsdom'),
    path = require('path'),
    redis = require('redis'),
    twitter = require('./twitter');

var revision, rules;

if (!config.REDIS_OPTIONS)
	config.REDIS_OPTIONS = {port: 6379};

function redis_client() {
	return redis.createClient(config.REDIS_OPTIONS.port);
}
(function () {
	var r = redis_client();
	r.get('rev:ctr', function (err, num) {
		if (err)
			throw err;
		revision = parseInt(num);
		if (!revision) {
			revision = 1;
			rules = fs.readFileSync('rules.txt', 'UTF-8');
			r.mset(['rev:ctr', revision, 'rev:1', rules], function (err, rs) {
				if (err)
					throw err;
				console.log("Made initial revision.");
				r.quit();
			});
		}
		else {
			r.get('rev:' + revision, function (err, val) {
				if (err)
					throw err;
				rules = val;
				console.log("At revision " + revision + ".");
				r.quit();
			});
		}
	});
})();

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
var jquery_js = path.join(__dirname, 'www', 'jquery-1.5.min.js');

DOM.prototype.render = function () {
	return '<!doctype html><title>' + this.title + '</title>' +
		'<script></script><link rel="stylesheet" href="style.css">' +
		this.document.body.innerHTML +
		'<script src="jquery-1.5.min.js"></script>' +
		'<script src="socket.io.js"></script>' +
		'<script>socket=new io.Socket(location.domain,{port:' + config.HTTP_PORT +
		",transports:['websocket','htmlfile','xhr-multipart','xhr-polling','jsonp-polling']});</script>" +
		'<script src="client.js"></script>';
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
	$('<h3>Revision ' + revision + '</h3>').appendTo('body');
	var ul = $('<ul/>').appendTo('body');
	var num = 0;
	rules.split('\n').forEach(function (rule) {
		num++;
		if (!rule.trim())
			return;
		var li = $('<li id="line' + num + '"/>');
		var m = rule.match(/^\s*(\d+)\.(.*)/);
		if (m) {
			rule = m[2];
			li.attr('class', 'rule');
			var n = m[1];
			li.append('<a id="' + n + '" href="#' + n + '">' + n + '</a>.');
		}
		if (rule.match(/^\*.*\*$/))
			rule = $('<b/>').text(rule.slice(1, -1));
		else
			rule = document.createTextNode(rule);
		li.append(rule).appendTo(ul);
	});
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

if (config.DEBUG)
	app.post('/login/', function (req, resp) {
		req.session.username = 'test';
		resp.redirect('..');
	});
else {
	app.post('/login/', twitter.start_login.bind(twitter, redis_client));
	app.get('/login/', twitter.confirm_login.bind(twitter, redis_client));
}

app.listen(config.HTTP_PORT);

var listener = io.listen(app);
listener.on('connection', function (socket) {
	var r = redis_client();
	socket.on('message', function (data) {
		if (typeof data != 'object')
			return;
		if (data.a == 'expand' && data.line)
			socket.send({a: 'expand', line: data.line, v: ['mite b cool']});
		else if (data.a == 'count' && parseInt(data.rev)) {
			r.hgetall('rev:' + parseInt(data.rev) + ':count', function (err, counts) {
				if (err)
					return console.log(err);
				socket.send({a: 'count', v: counts});
			});
		}
	});
	socket.on('disconnect', function () {
		r.quit();
	});
	socket.on('error', function (err) {
		console.error(err);
		r.quit();
	});
	r.on('error', function (err) {
		console.error(err);
	});
});
listener.on('error', console.error.bind(console));
