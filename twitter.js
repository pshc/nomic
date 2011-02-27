var config = require('./config'),
    oauth = require('oauth');

var request_token_url = "https://api.twitter.com/oauth/request_token";
var access_token_url = "https://api.twitter.com/oauth/access_token";
var authorize_url = "https://api.twitter.com/oauth/authorize";

var oa = new oauth.OAuth(request_token_url, access_token_url,
		config.TWITTER_CONSUMER_KEY,
		config.TWITTER_CONSUMER_SECRET,
		'1.0', null, 'HMAC-SHA1');

exports.start_login = function (redis_client, req, resp) {
	oa.getOAuthRequestToken(function (err, token, secret, results) {
		if (err) {
			console.error(err);
			resp.writeHead(500, {});
			resp.end('OAuth error.');
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
};

exports.confirm_login = function (redis_client, req, resp) {
	if (!req.query.oauth_token || !req.query.oauth_verifier) {
		resp.redirect('..');
		return;
	}
	var token = req.query.oauth_token;
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
		oa.getOAuthAccessToken(token, secret, req.query.oauth_verifier,
				function (err, access_token, access_token_secret, results) {
			if (err) {
				resp.writeHead(500, {});
				if (parseInt(err.statusCode) == 401)
					resp.end("OAuth permission failure.");
				else {
					resp.end("OAuth error.");
					console.error(err);
				}
				return;
			}
			req.session.username = results.screen_name;
			resp.redirect('..');
		});
	});
};
