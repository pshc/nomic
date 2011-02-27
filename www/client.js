$(function () {

$(document).click(function (event) {
	var a = $(event.target), li = a.parent();
	if (!(a.is('a') && li.is('li') && !a.prev().length))
		return true;
	if (li.children('aside').detach().length)
		return false;
	var count = parseInt(a.text().match(/\((\d+)\)/)[1]);
	var aside = $('<aside/>');
	aside.text('Request for comments.');
	li.append(aside);
});

});
