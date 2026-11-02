import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { UserService, SaveConfigInput } from '../../modules/user/user.service';

@Controller('api/user')
export class UserController {
  constructor(private readonly user: UserService) {}

  @Get('config')
  async getConfig(@Req() req: { userId: bigint }) {
    return this.user.getConfig(req.userId);
  }

  @Post('config')
  async saveConfig(@Req() req: { userId: bigint }, @Body() body: SaveConfigInput) {
    return this.user.saveConfig(req.userId, body);
  }
}
