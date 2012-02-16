var jsdom = require('jsdom'),
    path = require('path');

function DOM(resp) {
	this.resp = resp;
}
exports.DOM = DOM;

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
		callback.call(self, window.$);
	});
};
var jquery_js = path.join(__dirname, 'www', 'jquery-1.5.min.js');

DOM.prototype.write = function (resp) {
	resp.write('<!doctype html><title>' + this.title + '</title>' +
		'<script></script><link rel="stylesheet" href="style.css">');
	resp.write(this.document.body.innerHTML);
};

/* Wraps given function; last argument must be a Response object */
exports.handler = function (f) {
	return function (req, resp, context) {
		var d = new DOM(resp);
		d.setup(f.bind(null, req, resp, context));
	};
};
