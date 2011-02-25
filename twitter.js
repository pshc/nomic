var config = require('./config'),
    oauth = require('oauth'),
    redis = require('redis'),
    url_parse = require('url').parse;

var request_token_url = "https://api.twitter.com/oauth/request_token";
var access_token_url = "https://api.twitter.com/oauth/access_token";
var authorize_url = "https://api.twitter.com/oauth/authorize";

var oa = new oauth.OAuth(request_token_url, access_token_url,
		config.TWITTER_CONSUMER_KEY,
		config.TWITTER_CONSUMER_SECRET,
		'1.0', null, 'HMAC-SHA1');

var client_tokens = {};

function redis_client() {
	return redis.createClient(config.REDIS_OPTIONS.port);
}

var headers = {'Content-Type': 'text/html; charset=UTF-8'};
function twitter_login(req, resp) {
	var url = url_parse(req.url, true);

	if (url.query.oauth_token && url.query.oauth_verifier) {
		var token = url.query.oauth_token;
		var r = redis_client();
		var key = 'oauthtoken:' + token;
		r.get(key, function (err, secret) {
			if (err) {
				console.error(err);
				resp.writeHead(500, {});
				resp.end('Redis error.');
				r.quit();
				return;
			}
			if (!secret) {
				resp.writeHead(401, {});
				resp.end("Expired or invalid. Try again.");
				r.quit();
				return;
			}
			r.del(key);
			r.quit();
			oa.getOAuthAccessToken(token, secret,
					url.query.oauth_verifier,
					go_time.bind(null, req, resp));
		});
		return;
	}

	oa.getOAuthRequestToken(function (err, token, secret, results) {
		if (err) {
			resp.writeHead(500, {});
			resp.end(err);
			return;
		}
		var r = redis_client();
		var key = 'oauthtoken:' + token;
		r.multi().set(key, secret).expire(key, 600).exec(function (e) {
			r.quit();
			if (e) {
				console.error(e);
				resp.writeHead(500, {});
				resp.end('Redis error.');
				return;
			}
			var go = authorize_url + '?oauth_token=' + token;
			resp.writeHead(302, {Location: go});
			resp.end();
		});
	});
}

function go_time(req, resp, err, access_token, access_token_secret, results) {
	if (err) {
		resp.writeHead(500, {});
		if (parseInt(err.statusCode) == 401)
			resp.end("OAuth permission failure.");
		else
			resp.end(err);
		return;
	}
	req.session.username = results.screen_name;
	resp.redirect('..');
}

exports.twitter_login = twitter_login;
