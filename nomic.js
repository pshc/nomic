var config = require('./config'),
    express = require('express'),
    RedisStore = require('connect-redis'),
    twitter = require('./twitter');

var app = express.createServer();

app.use(express.cookieDecoder());
app.use(express.session({ store: new RedisStore(config.REDIS_OPTIONS),
		secret: config.SESSION_SECRET }));

app.get('/', function (req, resp) {
	var username = req.session.username;
	if (username)
		resp.send('Hi ' + username + '!');
	else
		resp.send('Hi. <a href="login/">Login via Twitter</a>.');
});

app.get('/login/', twitter.twitter_login);

app.listen(config.HTTP_PORT);
