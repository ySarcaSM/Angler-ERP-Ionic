import { Component } from '@angular/core';
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

  constructor(private readonly auth: AuthService) {}

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
