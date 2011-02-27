$(function () {

socket.connect();
socket.on('message', function (data) {
	var li = $('#line'+data.line);
	var aside = $('<aside/>').appendTo(li);
	for (var i = 0; i < data.v.length; i++)
		$('<em/>').text(data.v[i]).appendTo(aside);
});

$(document).click(function (event) {
	var a = $(event.target), li = a.parent();
	if (!(a.is('a') && li.is('li') && !a.prev().length))
		return true;
	if (li.children('aside').detach().length)
		return false;
	socket.send({a: 'expand', line: li.attr('id').slice(4)});
});

});
