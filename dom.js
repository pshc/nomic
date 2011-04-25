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
		callback.call(self, window.$, window.document);
	});
};
var jquery_js = path.join(__dirname, 'www', 'jquery-1.5.min.js');

DOM.prototype.render = function (after) {
	return '<!doctype html><title>' + this.title + '</title>' +
		'<script></script><link rel="stylesheet" href="style.css">' +
		this.document.body.innerHTML + (after || '');
};

exports.handler = function (f) {
	return function (req, resp) {
		var d = new DOM(resp);
		d.setup(f.bind(d, req, resp));
	};
};
