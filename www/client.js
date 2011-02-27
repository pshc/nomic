$(function () {

var revision = $('h3').text().match(/Revision (\d+)/)[1];

socket.connect();
socket.send({a: 'count', rev: revision});
socket.on('message', function (data) {
	if (data.a == 'count') {
		$('li').each(function () {
			var li = $(this);
			var line = li.attr('id').slice(4);
			li.prepend('<a class="talk">(' + (data.v[line] || 0) + ')</a>');
		});
	}
	else if (data.a == 'expand') {
		var li = $('#line'+data.line);
		var aside = $('<aside/>').appendTo(li);
		for (var i = 0; i < data.v.length; i++)
			$('<em/>').text(data.v[i]).appendTo(aside);
		if (window.pin)
			$('<input>').appendTo(aside).focus();
	}
	else if (data.a == 'comment') {
		var line = $('#line'+data.line);
		line.children('.talk').text('('+data.count+')');
		var aside = line.children('aside');
		var em = $('<em/>').text(data.v);
		var input = aside.children('input');
		if (input.length)
			input.before(em);
		else
			aside.append(em);
	}
});

$(document).click(function (event) {
	var a = $(event.target), li = a.parent();
	if (!a.is('.talk'))
		return true;
	if (li.children('aside').detach().length)
		return false;
	socket.send({a: 'expand', line: li.attr('id').slice(4)});
});

$(document).keydown(function (event) {
	if (event.which != 13)
		return true;
	var input = $(event.target);
	if (!input.is('input'))
		return true;
	var id = input.parents('li').attr('id');
	if (typeof id != 'string')
		return true;
	var m = id.match(/line(\d+)/);
	var v = input.val().trim();
	if (!m || !v)
		return true;
	socket.send({a: 'comment', line: m[1], v: v, pin: pin});
	input.val('');
});

});
