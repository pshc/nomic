var config = require('./config'),
    dom = require('./dom'),
    fs = require('fs'),
    io = require('socket.io'),
    path = require('path'),
    redis = require('redis'),
    twitter = require('./twitter');

var revision, rules;

function redis_client() {
	return redis.createClient(config.REDIS_OPTIONS.port);
}
(function () {
	var r = redis_client();
	r.get('rev:ctr', function (err, num) {
		if (err)
			throw err;
		revision = parseInt(num, 10);
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

var routes = {get: [], post: []};
function route(method, path, func) {
	routes[method].push({re: path, func: func});
}

var server = require('http').createServer(function (req, resp) {
	var rs = routes[req.method.toLowerCase()];
	var url = req.url;
	if (rs) {
		for (var i = 0; i < rs.length; i++) {
			var route = rs[i];
			var m = url.match(route.re);
			if (m) {
				req.params = [];
				for (var j = 1; j <= m.length; j++)
					req.params.push(m[j]);
				route.func(req, resp);
				return;
			}
		}
	}
	console.log('wtf is', url);
	notFound(resp);
});

route('get', /^\/$/, function (req, resp) {
	redirect(resp, 'rev' + revision);
});

route('get', /^\/rev(\d+)/, function (req, resp) {
	var rev = parseInt(req.params[0], 10);
	if (!rev)
		notFound(resp);
	else if (rev == revision)
		render_revision(req, resp, {rev: revision, rules: rules});
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
				render_revision(req, resp, {rev: rev, rules: rules});
		});
	}
});

var render_revision = dom.handler(function (req, resp, context, $) {
	var rev = context.rev, rules = context.rules;
	console.log('rendering', rules);
	var document = this.document;
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
		if (rev == revision && can_revise(username))
			form.after('<a href="new/">New revision</a>');
	}
	else {
		button.attr('value', 'Login via Twitter');
		form.attr('action', 'login/');
	}
	$('<h3>Revision ' + rev + '</h3>').appendTo('body');
	if (rev > 1)
		$('body').append('<a href="rev' + (rev-1) + '">Previous revision</a><br />');
	if (rev < revision)
		$('body').append('<a href="rev' + (rev+1) + '">Next revision</a><br />');
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
		if (rule.match(/^\s*\*.*\*\s*$/))
			rule = $('<b/>').text(rule.trim().slice(1, -1));
		else
			rule = document.createTextNode(rule);
		li.append(rule).appendTo(ul);
	});
	this.write(resp);
	var after = '<script src="jquery-1.5.min.js"></script>' +
		'<script src="socket.io.js"></script><script>' + (pin ? 'pin=' + pin + ';' : '') +
		'socket=new io.Socket(location.domain,{port:' + config.HTTP_PORT +
		",transports:['htmlfile','xhr-polling','jsonp-polling']});</script>" +
		'<script src="client.js"></script>';
	resp.end(after);
});

route('post', /^\/$/, function (req, resp) {
	if (req.body.logout) {
		delete req.session.username;
		redirect(resp, '.');
	}
	else
		notFound(resp);
});

if (config.DEBUG)
	route('post', /^\/login\/$/, function (req, resp) {
		req.session.username = 'test';
		resp.redirect('..');
	});
else {
	route('post', /^\/login\/$/, twitter.start_login.bind(twitter, redis_client));
	route('get', /^\/login\/$/, twitter.confirm_login.bind(twitter, redis_client));
}

function can_revise(username) {
	return username == 'pshc' || config.DEBUG;
}

route('get', /^\/new\/$/, dom.handler(function (req, resp, context, $) {
	if (!can_revise(req.session.username))
		return send(403);
	this.title = 'New revision';
	var textarea = $('<textarea name="v">').text(rules);
	var form = $('<form method="POST" action="."><input type="submit"></form>').prepend(textarea);
	$('body').append('<h3>New revision</h3>').append(form);
	this.write(resp);
	resp.end();
}));

route('post', /^\/new\/$/, function (req, resp) {
	if (!req.body.v)
		return req.send(400);
	var r = redis_client();
	r.incr('rev:ctr', function (err, new_rev) {
		if (err)
			throw err;
		r.multi().set('rev:' + new_rev, req.body.v).exec(function (err) {
			if (err)
				throw err;
			/* XXX Race condition */
			revision = new_rev;
			rules = req.body.v;
			resp.redirect('..');
		});
	});
});

function notFound(resp) {
	resp.writeHead(404);
	resp.end('404');
}

function redirect(resp, href) {
	resp.writeHead(303, {Location: href});
	resp.end();
}

server.listen(config.HTTP_PORT);

var listener = io.listen(server);
listener.on('connection', function (socket) {
	var r = redis_client();
	socket.on('message', function (data) {
		if (typeof data != 'object')
			return;
		var line = parseInt(data.line, 10), rev = socket.revision;
		if (data.a == 'expand' && rev && line) {
			r.lrange('rev:'+rev+':line:'+line, 0, -1, function (err, v) {
				if (err)
					return console.error(err); /* XXX */
				socket.send({a: 'expand', line: line, v: v});
			});
		}
		else if (data.a == 'count' && parseInt(data.rev, 10)) {
			rev = parseInt(data.rev, 10);
			r.exists('rev:' + rev, function (err, exists) {
				if (err)
					return console.error(err); /* XXX */
				if (!exists)
					return; /* XXX */
				socket.revision = rev;
				r.hgetall('rev:' + rev + ':count', function (err, counts) {
					if (err)
						return console.error(err); /* XXX */
					socket.send({a: 'count', v: counts});
				});
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
