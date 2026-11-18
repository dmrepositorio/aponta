import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { createFakePrisma } from '../testing/fake-prisma';

/**
 * Seam 1 (HTTP) na aplicação real (AppModule, sem módulo de teste montado à mão): a flag
 * `convite-e-redefinicao-usuario` ligada tem de chegar às rotas públicas de senha de /auth.
 * Os specs HTTP que montam os providers à mão não pegam um módulo sem a flag injetada, e foi isso
 * que deixou "Esqueci minha senha" em 404 em produção com a flag ligada (DMTE-551, validação humana).
 */
const FLAG_ENV = 'FEATURE_CONVITE_E_REDEFINICAO_USUARIO';

describe('Rotas públicas de senha na aplicação real (DMTE-551)', () => {
  let app: INestApplication;
  const saved = { jwt: process.env.JWT_SECRET, flag: process.env[FLAG_ENV] };

  const boot = async (flag: 'true' | 'false') => {
    process.env.JWT_SECRET = 'test-secret-key-for-app-module-compilation';
    process.env[FLAG_ENV] = flag;
    const module = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(PrismaService)
      .useValue(createFakePrisma())
      .compile();
    app = module.createNestApplication();
    await app.init();
  };
  const post = (url: string, body: object) => request(app.getHttpServer()).post(url).set('X-Forwarded-For', '203.0.113.9').send(body);

  afterEach(async () => {
    await app?.close();
    process.env.JWT_SECRET = saved.jwt;
    if (saved.flag === undefined) delete process.env[FLAG_ENV];
    else process.env[FLAG_ENV] = saved.flag;
  });

  it('AC-24: com a flag ligada, "Esqueci minha senha" responde 200 igual para qualquer e-mail', async () => {
    await boot('true');

    const res = await post('/auth/forgot-password', { email: 'ninguem@aponta.test' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true });
  });

  it('AC-24: com a flag ligada, definir senha com link inválido responde 400 e não 404', async () => {
    await boot('true');

    const res = await post('/auth/password/set', { token: 'link-que-nao-existe', password: 'Cavalo#Azul-7418' });

    expect(res.status).toBe(400);
  });

  it('AC-24: com a flag desligada, as duas rotas somem (404)', async () => {
    await boot('false');

    expect((await post('/auth/forgot-password', { email: 'ninguem@aponta.test' })).status).toBe(404);
    expect((await post('/auth/password/set', { token: 'x', password: 'Cavalo#Azul-7418' })).status).toBe(404);
  });
});
