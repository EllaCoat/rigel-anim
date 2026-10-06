# Three boxes that differ along x and z, so a mirrored or turned camera does not line up by chance.
# Coordinates keep a decimal point: summon moves whole-number x and z to the block's centre.
summon block_display 0.0 -60.0 0.0 {block_state:{Name:"minecraft:white_concrete"},transformation:{translation:[-0.5f,0f,-0.5f],left_rotation:[0f,0f,0f,1f],scale:[1f,1f,1f],right_rotation:[0f,0f,0f,1f]}}
summon block_display 1.0 -60.0 -0.25 {block_state:{Name:"minecraft:orange_concrete"},transformation:{translation:[0f,0f,0f],left_rotation:[0f,0f,0f,1f],scale:[0.5f,0.5f,0.5f],right_rotation:[0f,0f,0f,1f]}}
summon block_display -0.125 -60.0 -1.25 {block_state:{Name:"minecraft:blue_concrete"},transformation:{translation:[0f,0f,0f],left_rotation:[0f,0f,0f,1f],scale:[0.25f,1.5f,0.25f],right_rotation:[0f,0f,0f,1f]}}
