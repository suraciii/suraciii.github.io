type 用户ID = string;
type 活动类型 = string;

type 抽奖活动 = {
	Id: string;
	类型: 活动类型;
}

type 抽奖机会 = {
	Id: string;
	持有人: 用户ID;
	类型: '有偿' | '无偿';
	过期时间: Date;
	状态: '未使用' | '已使用';
};


function 获取抽奖机会(用户: 用户ID): 抽奖机会 {
	throw "not implemented";
}

function 已过期(活动: 抽奖活动): 抽奖机会 {
	throw "not implemented";
}

function 使用抽奖机会(机会: 抽奖机会, 活动: 抽奖活动) {
	throw "not implemented";
}

function 抽奖(活动: 抽奖活动, 用户ID: 用户ID) {

	if(已过期(活动)) {
		throw '活动已过期'
	}

	const 机会 = 获取抽奖机会(用户ID) // 优先注册赠送 优先临近过期

	使用抽奖机会(机会, 活动)
}

