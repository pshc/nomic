$(function () {

socket.connect();
socket.send({a: 'count', rev: $('h3').text().match(/Revision (\d+)/)[1]});
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

});
