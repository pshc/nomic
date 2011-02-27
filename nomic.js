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

DOM.prototype.render = function (after) {
	return '<!doctype html><title>' + this.title + '</title>' +
		'<script></script><link rel="stylesheet" href="style.css">' +
		this.document.body.innerHTML + after;
};

function dom_handler(f) {
	return function (req, resp) {
		var dom = new DOM(resp);
		dom.setup(f.bind(dom, req, resp));
	};
}

app.get('/', function (req, resp) {
	resp.redirect('rev' + revision);
});

app.get('/rev:rev', function (req, resp) {
	var rev = parseInt(req.param('rev'));
	if (!rev)
		resp.send(404);
	else if (rev == revision)
		render_revision(revision, rules, req, resp);
	else {
		var r = redis_client();
		r.get('rev:' + rev, function (err, rules) {
			r.quit();
			if (err) {
				resp.send(500);
				console.error(err);
			}
			else if (!rules)
				resp.send(404);
			else
				render_revision(rev, rules, req, resp);
		});
	}
});

function render_revision(rev, rules, req, resp) {
	(new DOM(resp)).setup(function ($, document) {

	this.title = 'Nomic';
	var username = req.session.username;
	var button = $('<input type="submit"/>');
	var form = $('<form method="POST"/>').append(button).appendTo('body');
	var pin;
	if (username) {
		form.prepend('Hi ' + username + '! ');
		button.attr('name', 'logout').attr('value', 'Logout');
		form.attr('action', '.');
		pin = Math.ceil(Math.random() * 1e16);
		/* XXX: Should wait for completion */
		var r = redis_client();
		r.multi().set('pin:' + pin, username).expire('pin:' + pin, 60*60*24).exec(function (err) {
			if (err)
				console.error(err);
			r.quit();
		});
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
	var after = '<script src="jquery-1.5.min.js"></script>' +
		'<script src="socket.io.js"></script><script>' + (pin ? 'pin=' + pin + ';' : '') +
		'socket=new io.Socket(location.domain,{port:' + config.HTTP_PORT +
		",transports:['websocket','htmlfile','xhr-multipart','xhr-polling','jsonp-polling']});</script>" +
		'<script src="client.js"></script>';
	resp.send(this.render(after));

	}); /* DOM */
}

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
		var rev = parseInt(data.rev), line = parseInt(data.line);
		if (data.a == 'expand' && rev && line) {
			r.lrange('rev:'+rev+':line:'+line, 0, -1, function (err, v) {
				if (err)
					return console.error(err); /* XXX */
				socket.send({a: 'expand', line: line, v: v});
			});
		}
		else if (data.a == 'count' && rev) {
			socket.revision = rev;
			r.hgetall('rev:' + rev + ':count', function (err, counts) {
				if (err)
					return console.error(err); /* XXX */
				socket.send({a: 'count', v: counts});
			});
		}
		else if (data.a == 'comment' && rev && line && data.v && data.pin) {
			r.get('pin:' + data.pin, function (err, username) {
				if (err)
					return console.error(err);
				if (!username)
					return; /* XXX: report */
				var msg = '<' + username + '> ' + data.v;
				var m = r.multi();
				m.hincrby('rev:'+rev+':count', line, 1);
				m.rpush('rev:'+rev+':line:'+line, msg);
				m.exec(function (err, rs) {
					if (err)
						return console.log(err); /* XXX */
					var packet = {a: 'comment', line: line, v: msg, count: rs[0]};
					for (var id in listener.clients) {
						var client = listener.clients[id];
						if (client.revision == rev)
							client.send(packet);
					}
				});
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
