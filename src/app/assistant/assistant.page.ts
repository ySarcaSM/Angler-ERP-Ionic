import { ChangeDetectorRef, Component, inject, OnInit } from '@angular/core';
import { ToastController } from '@ionic/angular/lazy';
import { AuthService } from '../core/auth.service';
import { ClientsService } from '../services/clients.service';
import { ProductsService } from '../services/products.service';

type ProviderId = 'openai' | 'openrouter' | 'groq' | 'together' | 'deepseek' | 'gemini' | 'custom';
interface ProviderConfig { id: ProviderId; name: string; baseUrl: string; modelsUrl?: string; }
interface ChatMessage { role: 'user' | 'assistant'; content: string; createdAt: number; }
interface ChatThread { id: string; title: string; messages: ChatMessage[]; updatedAt: number; }
interface ModelOption { id: string; name: string; }

const PROVIDERS: ProviderConfig[] = [
  { id: 'openai', name: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1' },
  { id: 'groq', name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { id: 'together', name: 'Together AI', baseUrl: 'https://api.together.xyz/v1' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { id: 'gemini', name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'custom', name: 'Compatível com OpenAI / endpoint próprio', baseUrl: '' }
];

@Component({
  selector: 'app-assistant',
  templateUrl: './assistant.page.html',
  styleUrls: ['./assistant.page.scss'],
  standalone: false
})
export class AssistantPage implements OnInit {
  readonly auth = inject(AuthService);
  private readonly clientsService = inject(ClientsService);
  private readonly productsService = inject(ProductsService);
  private readonly toastController = inject(ToastController);
  private readonly cdr = inject(ChangeDetectorRef);

  readonly providers = PROVIDERS;
  providerId: ProviderId = 'openrouter';
  apiKey = '';
  customBaseUrl = '';
  modelId = '';
  models: ModelOption[] = [];
  chats: ChatThread[] = [];
  activeChatId = '';
  draft = '';
  loading = false;
  loadingModels = false;
  testing = false;
  settingsOpen = true;
  status = '';
  private readonly storageKey = 'angler-assistant-chats-v1';

  ngOnInit(): void {
    this.loadChats();
    if (!this.chats.length) this.newChat();
  }

  get activeChat(): ChatThread | undefined { return this.chats.find(chat => chat.id === this.activeChatId); }
  get selectedProvider(): ProviderConfig { return this.providers.find(provider => provider.id === this.providerId) ?? this.providers[0]; }
  get endpoint(): string { return (this.providerId === 'custom' ? this.customBaseUrl : this.selectedProvider.baseUrl).trim().replace(/\/$/, ''); }

  newChat(): void {
    const now = Date.now();
    const chat: ChatThread = { id: this.makeId(), title: 'Nova conversa', messages: [], updatedAt: now };
    this.chats = [chat, ...this.chats];
    this.activeChatId = chat.id;
    this.saveChats();
  }

  selectChat(id: string): void { this.activeChatId = id; }
  renameChat(chat: ChatThread): void {
    const value = window.prompt('Novo nome para a conversa:', chat.title);
    if (value?.trim()) { chat.title = value.trim().slice(0, 80); this.saveChats(); }
  }
  deleteChat(chat: ChatThread): void {
    if (!window.confirm(`Excluir a conversa "${chat.title}" deste navegador?`)) return;
    this.chats = this.chats.filter(item => item.id !== chat.id);
    if (this.activeChatId === chat.id) this.activeChatId = this.chats[0]?.id ?? '';
    if (!this.activeChatId) this.newChat();
    this.saveChats();
  }

  async loadModels(): Promise<void> {
    this.loadingModels = true; this.status = '';
    try {
      if (!this.apiKey.trim()) throw new Error('Informe a API key do provedor. Ela fica somente na memória desta página.');
      const models = await this.fetchModels(this.providerId, this.apiKey.trim(), this.endpoint);
      this.models = models;
      if (!models.some(model => model.id === this.modelId)) this.modelId = models[0]?.id ?? '';
      this.status = models.length ? `${models.length} modelo(s) carregado(s).` : 'A API respondeu, mas não retornou modelos.';
    } catch (error) { this.status = this.message(error); }
    finally { this.loadingModels = false; this.cdr.markForCheck(); }
  }

  async testApi(): Promise<void> {
    this.testing = true; this.status = 'Testando conexão e modelo...';
    try {
      if (!this.apiKey.trim()) throw new Error('Informe a API key.');
      const available = this.models.length ? this.models : await this.fetchModels(this.providerId, this.apiKey.trim(), this.endpoint);
      const model = available.find(item => item.id === this.modelId) ?? available[0];
      if (!model) throw new Error('Nenhum modelo disponível para testar.');
      await this.callProvider(this.providerId, this.apiKey.trim(), this.endpoint, model.id, [
        { role: 'user', content: 'Responda somente: conexão funcionando.' }
      ]);
      this.models = available; this.modelId = model.id;
      this.status = `API funcionando. Modelo testado: ${model.id}`;
    } catch (error) { this.status = `Falha no teste: ${this.message(error)}`; }
    finally { this.testing = false; this.cdr.markForCheck(); }
  }

  async findFirstWorking(): Promise<void> {
    this.loadingModels = true; this.status = 'Procurando primeiro provedor configurado que funcione...';
    const order: ProviderId[] = ['openrouter', 'openai', 'groq', 'together', 'deepseek', 'gemini', 'custom'];
    try {
      for (const id of order) {
        if (id === 'custom') continue;
        if (id !== this.providerId || !this.apiKey.trim()) continue;
        try {
          const models = await this.fetchModels(id, this.apiKey.trim(), this.endpoint);
          for (const model of models.slice(0, 5)) {
            try {
              await this.callProvider(id, this.apiKey.trim(), this.endpoint, model.id, [
                { role: 'user', content: 'Responda somente: ok.' }
              ]);
              this.models = models; this.modelId = model.id;
              this.status = `Primeiro modelo funcional encontrado: ${this.selectedProvider.name} / ${model.id}`;
              return;
            } catch { /* tenta o próximo modelo */ }
          }
        } catch { /* provedor não respondeu; tenta o próximo configurado */ }
      }
      this.status = 'Não encontrei um modelo funcional. Selecione um provedor, informe sua chave e tente novamente. Por segurança, não tento provedores sem uma chave informada.';
    } finally { this.loadingModels = false; this.cdr.markForCheck(); }
  }

  handleEnter(event: KeyboardEvent): void {
    if (!event.shiftKey) { event.preventDefault(); void this.send(); }
  }

  async send(): Promise<void> {
    const prompt = this.draft.trim();
    if (!prompt || this.loading) return;
    if (!this.apiKey.trim()) { this.status = 'Abra as configurações e informe sua API key.'; this.settingsOpen = true; return; }
    if (!this.modelId) { this.status = 'Carregue os modelos e selecione um modelo.'; this.settingsOpen = true; return; }
    if (!this.activeChat) this.newChat();
    const chat = this.activeChat!;
    this.draft = '';
    chat.messages.push({ role: 'user', content: prompt, createdAt: Date.now() });
    if (chat.messages.length === 1 && chat.title === 'Nova conversa') chat.title = prompt.slice(0, 42) + (prompt.length > 42 ? '…' : '');
    chat.updatedAt = Date.now(); this.saveChats(); this.loading = true; this.status = '';
    try {
      const context = await this.buildBusinessContext(prompt);
      const system = [
        'Você é o assistente de IA do AnglerERP. Responda em português brasileiro, com clareza e objetividade.',
        'Use os dados do contexto empresarial abaixo para responder perguntas sobre clientes e produtos. Não invente registros nem campos ausentes. Respeite os dados da empresa da sessão.',
        'Você pode fazer cálculos matemáticos. Mostre premissas, fórmula e resultado. Para corte/encaixe de peças, diferencie limite teórico por área de um plano de corte realmente otimizado; nunca prometa encaixe físico exato sem um algoritmo de nesting.',
        'A chave de API é enviada diretamente do navegador ao provedor selecionado e não deve ser mencionada nem repetida.',
        context
      ].join('\n\n');
      const history = chat.messages.slice(-16).map(message => ({ role: message.role, content: message.content }));
      const answer = await this.callProvider(this.providerId, this.apiKey.trim(), this.endpoint, this.modelId, [
        { role: 'system', content: system }, ...history
      ]);
      chat.messages.push({ role: 'assistant', content: answer, createdAt: Date.now() });
      chat.updatedAt = Date.now(); this.saveChats();
    } catch (error) {
      chat.messages.push({ role: 'assistant', content: `Não consegui concluir a solicitação: ${this.message(error)}\n\nConfira a chave, o provedor e o modelo nas configurações.`, createdAt: Date.now() });
      this.saveChats();
    } finally { this.loading = false; this.cdr.markForCheck(); }
  }

  private async buildBusinessContext(prompt: string): Promise<string> {
    const lower = prompt.toLocaleLowerCase('pt-BR');
    const wantsClients = /cliente|clientes|contato|contatos|comprador/.test(lower);
    const wantsProducts = /produto|produtos|estoque|preço|precos|venda|vendas|melhor|relatório|relatorio|mochila/.test(lower);
    const wantsCalculation = /quant|calcule|calcular|cálculo|calculo|medida|medidas|plano|área|area|quanto|porcentagem|margem/.test(lower);
    const sections: string[] = [];
    if (wantsClients) {
      try {
        const clients = await this.clientsService.list();
        sections.push('CLIENTES DISPONÍVEIS PARA ESTA SESSÃO:\n' + JSON.stringify(clients.map(c => ({
          nome: c.name, documento: c.document, email: c.email, telefone: c.phone, contato: c.contact, endereço: c.address, ativo: c.active
        }))));
      } catch (error) { sections.push('CLIENTES: não foi possível ler o módulo com as permissões atuais (' + this.message(error) + ').'); }
    }
    if (wantsProducts) {
      try {
        const products = await this.productsService.list();
        sections.push('PRODUTOS DISPONÍVEIS PARA ESTA SESSÃO:\n' + JSON.stringify(products.map(p => ({
          nome: p.name, descrição: p.description, custo: p.costPrice, preçoVenda: p.sellPrice,
          estoqueAtual: p.stock?.current, estoqueMínimo: p.stock?.minimum, estoqueMáximo: p.stock?.maximum,
          localização: p.stock?.location, ativo: p.active
        }))));
      } catch (error) { sections.push('PRODUTOS: não foi possível ler o módulo com as permissões atuais (' + this.message(error) + ').'); }
    }
    if (wantsCalculation) {
      sections.push('CÁLCULOS: faça contas com precisão. Para embalagens/peças retangulares e chapa retangular, diferencie limite teórico por área de plano de corte otimizado; área dividida não comprova que as peças caibam por encaixe.');
      const dimensions = prompt.match(/(?:medidas?|dimens(?:ões|oes))?\\s*(\\d+(?:[.,]\\d+)?)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)\\s*[x×]\\s*(\\d+(?:[.,]\\d+)?)/i);
      const plan = prompt.match(/(?:plano|chapa|tecido|material)\\s*(?:de\\s*)?(\\d+(?:[.,]\\d+)?)\\s*[x×/\\-]\\s*(\\d+(?:[.,]\\d+)?)/i);
      if (dimensions && plan) {
        const [a, b, d] = dimensions.slice(1).map(value => Number(value.replace(',', '.')));
        const [width, height] = plan.slice(1).map(value => Number(value.replace(',', '.')));
        if ([a, b, d, width, height].every(value => Number.isFinite(value) && value > 0)) {
          const panelArea = 2 * a * b + 2 * b * d + a * d;
          const sheetArea = width * height;
          const theoretical = Math.floor(sheetArea / panelArea);
          sections.push('ESTIMATIVA MATEMÁTICA DETECTADA (unidades iguais): assumindo uma mochila simplificada composta por 2 painéis a×b, 2 laterais b×d e 1 fundo a×d, sem alças, bolsos, tampa, costuras nem margem de corte. Medidas informadas: ' + a + '×' + b + '×' + d + '; plano: ' + width + '×' + height + '. Área estimada de peças por mochila = 2ab + 2bd + ad = ' + panelArea + ' unidades². Área do plano = ' + sheetArea + ' unidades². Limite superior por área = floor(' + sheetArea + '/' + panelArea + ') = ' + theoretical + ' mochilas. Isto é somente um limite teórico por área; o número realmente cortável pode ser menor por causa do encaixe das peças, margens, sentido do tecido e perdas.');
        }
      }
    }
    return sections.length ? 'CONTEXTO DO ERP (dados atuais consultados na sessão):\n' + sections.join('\n\n') : 'Nenhum dado do ERP foi solicitado explicitamente. Se a pergunta depender de clientes/produtos, consulte os serviços correspondentes quando pertinente.';
  }

  private async fetchModels(provider: ProviderId, key: string, baseUrl: string): Promise<ModelOption[]> {
    if (provider === 'gemini') {
      const response = await fetch(`${baseUrl}/models?key=${encodeURIComponent(key)}`);
      const data = await this.readJson(response);
      return (data.models ?? []).filter((m: any) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
        .map((m: any) => ({ id: String(m.name).replace(/^models\//, ''), name: m.displayName ?? m.name }));
    }
    const url = `${baseUrl}/models`;
    const response = await fetch(url, { headers: { Authorization: `Bearer ${key}` } });
    const data = await this.readJson(response);
    return (data.data ?? data.models ?? []).map((m: any) => ({ id: String(m.id ?? m.name), name: String(m.name ?? m.id) }))
      .filter((m: ModelOption) => !!m.id).sort((a: ModelOption, b: ModelOption) => a.id.localeCompare(b.id));
  }

  private async callProvider(provider: ProviderId, key: string, baseUrl: string, model: string, messages: Array<{role: string; content: string}>): Promise<string> {
    let response: Response;
    if (provider === 'gemini') {
      const contents = messages.filter(m => m.role !== 'system').map(m => ({
        role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }]
      }));
      const system = messages.find(m => m.role === 'system')?.content;
      response = await fetch(`${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ systemInstruction: system ? { parts: [{ text: system }] } : undefined, contents, generationConfig: { temperature: 0.3 } })
      });
      const data = await this.readJson(response);
      return (data.candidates?.[0]?.content?.parts ?? []).map((part: any) => part.text ?? '').join('\n') || 'O modelo não retornou texto.';
    }
    response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, temperature: 0.3 })
    });
    const data = await this.readJson(response);
    return data.choices?.[0]?.message?.content ?? 'O modelo não retornou texto.';
  }

  private async readJson(response: Response): Promise<any> {
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error?.message ?? data.message ?? `HTTP ${response.status}: ${response.statusText}`);
    return data;
  }

  private loadChats(): void {
    try {
      const raw = localStorage.getItem(this.storageKey);
      const parsed = raw ? JSON.parse(raw) : [];
      this.chats = Array.isArray(parsed) ? parsed : [];
      this.activeChatId = this.chats[0]?.id ?? '';
    } catch { this.chats = []; }
  }
  private saveChats(): void {
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.chats)); } catch { this.status = 'Não foi possível salvar as conversas neste navegador.'; }
  }
  private makeId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
  private message(error: unknown): string { return error instanceof Error ? error.message : 'Erro desconhecido.'; }
}
