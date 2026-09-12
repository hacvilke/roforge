-- Tiny UI factory so the dock is built in plain Luau (no XAML to manage).

local COLORS = {
	Bg = Color3.fromRGB(24, 26, 31),
	Panel = Color3.fromRGB(32, 35, 42),
	Border = Color3.fromRGB(55, 60, 70),
	Text = Color3.fromRGB(230, 232, 238),
	Dim = Color3.fromRGB(150, 156, 168),
	Accent = Color3.fromRGB(88, 166, 255),
	UserBubble = Color3.fromRGB(40, 52, 70),
	ToolBubble = Color3.fromRGB(36, 40, 48),
	Error = Color3.fromRGB(235, 90, 90),
	Ok = Color3.fromRGB(90, 200, 140),
}

local FONT = Enum.Font.Gotham

local function mk(className, props, children)
	local inst = Instance.new(className)
	for k, v in pairs(props or {}) do
		if k ~= "Parent" then
			inst[k] = v
		end
	end
	for _, child in ipairs(children or {}) do
		child.Parent = inst
	end
	if props and props.Parent then
		inst.Parent = props.Parent
	end
	return inst
end

return {
	mk = mk,
	COLORS = COLORS,
	FONT = FONT,
}
