import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';

@Component({
  selector: 'app-login',
  templateUrl: './login.page.html',
  styleUrls: ['./login.page.scss'],
  standalone: false
})
export class LoginPage {
  email = '';
  password = '';
  loading = false;
  error = '';

  private readonly auth = inject(AuthService);

  async signInWithGoogle(): Promise<void> {
    this.error = '';
    this.loading = true;
    try {
      await this.auth.signInWithGoogle();
    } catch (error) {
      const code = (error as { code?: string })?.code;
      this.error = code === 'auth/popup-closed-by-user'
        ? 'A janela de login do Google foi fechada.'
        : code === 'auth/popup-blocked'
          ? 'O navegador bloqueou a janela do Google. Permita pop-ups e tente novamente.'
          : error instanceof Error ? error.message : 'Não foi possível entrar com o Google.';
    } finally {
      this.loading = false;
    }
  }

  async submit(): Promise<void> {
    this.error = '';
    if (!this.email.trim() || !this.password) {
      this.error = 'Informe e-mail e senha.';
      return;
    }
    this.loading = true;
    try {
      await this.auth.signIn(this.email, this.password);
    } catch (error) {
      this.error = error instanceof Error ? error.message : 'Não foi possível entrar. Confira suas credenciais.';
    } finally {
      this.loading = false;
    }
  }
}
