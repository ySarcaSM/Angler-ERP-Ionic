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

  handleEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) { keyboardEvent.preventDefault(); void this.send(); }
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
        'Use os dados do contexto empresarial abaixo para responder perguntas sobre clientes e produtos. Não invente dados ausentes. Respeite os dados e as permissões da empresa da sessão.',
        'Faça cálculos com as fórmulas oficiais do Angler ERP abaixo. Sempre informe premissas, fórmula, substituição dos valores, resultado e limitações. Não substitua uma fórmula oficial por aproximação de área sem avisar.',
        'FÓRMULAS OFICIAIS DO MÓDULO DE MEDIÇÃO/ORÇAMENTO (src/pages/budgets/ProfileGroupPage.jsx):',
        'VARIÁVEIS: H = altura do produto (cm); W = largura (cm); L = comprimento/profundidade (cm); S = largura de cada sanfona lateral (cm, 0 se não houver); Q = quantidade; D = desperdício percentual; MW = largura do material (cm). Todas as dimensões devem usar a mesma unidade; o módulo espera cm.',
        'ÁREA DE MATERIAL: bodyArea = H × (W + L + 2S), em cm². areaPorUnidade_m2 = (bodyArea / 10000) × (1 + D/100). areaTotal_m2 = areaPorUnidade_m2 × Q. Use esta fórmula para estimativa de área e desperdício, não para afirmar encaixe físico.',
        'PLANO FÍSICO: mesa nominal = 300 cm; sobra lateral = 19 cm de cada lado; comprimento útil U = 300 − 2×19 = 262 cm. Largura útil V = min(max(MW, 0), 150) cm. Para cada orientação, G = largura da peça principal + 2S; unidades por fileira = floor(U/G); fileiras = floor(V/altura da peça); capacidade = unidades por fileira × fileiras. Sempre arredonde cada eixo para baixo. Sem sanfona (S=0), teste orientação normal (W por H) e rotação 90° (H por W), escolhendo a maior capacidade; em empate, prefira menor soma das sobras. Com sanfona, o módulo não testa rotação. Nunca use floor(U×V/área da peça) como substituto da capacidade física por fileiras e colunas.',
        'SANFONAS: no perfil de mochila, S>0 significa 1 corpo + 2 sanfonas por unidade. Quantidade de sanfonas = 2×Q. Cada sanfona mede S×H; areaTotalSanfonas = 2×Q×S×H cm². Para acomodar o conjunto, G = largura da peça principal + 2S.',
        'LATERAIS: o módulo calcula as laterais separadamente: peça lateral com largura L, altura H e quantidade 2×Q. Com U=262 cm, peçasPorFileira = floor(U/L); fileirasNecessarias = ceil((2×Q)/peçasPorFileira); comprimentoDeCorte_cm = fileirasNecessarias×H. O resultado de capacidade do corpo principal não significa, sozinho, que há laterais suficientes; explique que corpos e laterais são cortes separados.',
        'MATERIAL LINEAR: fatorDesperdicio = 1 + D/100. O código estima comprimento linear total = numeroDePlanos × 300 × fatorDesperdicio, em cm; metros = comprimento_cm/100. Os planos são segmentados em larguras de até 150 cm e contam quando têm capacidade válida. Evite aplicar desperdício duas vezes ao mesmo valor.',
        'ACESSÓRIOS: referências do sistema para altura de 30 cm: 35 cm por alça e 60 cm por cordão. escala = H/30. comprimentoPorAlça_cm = 35×(H/30); comprimentoPorCordão_cm = 60×(H/30). Comprimento de acessórios por unidade = quantidadeDeAlças×comprimentoPorAlça ou quantidadeDeCordões×comprimentoPorCordão. Total em metros = comprimentoPorUnidade_cm×Q/100. São referências proporcionais, não medidas universais para todo modelo.',
        'ORÇAMENTO RÁPIDO: custoMaterial = (materialLinear_cm/100)×custoMaterialPorMetro. custoAcessorios = (metrosDeAlças + metrosDeCordões)×custoAcessorioPorMetro. custoMaoDeObra = Q×custoMaoDeObraPorUnidade. custoProducaoTotal = custoMaterial + custoAcessorios + custoMaoDeObra. custoPorUnidade = custoProducaoTotal/Q, se Q>0. valorVendaTotal = Q×precoVendaUnitario. lucroPorUnidade = precoVendaUnitario − custoPorUnidade. resultadoTotal = valorVendaTotal − custoProducaoTotal. Se pedirem margem sobre venda: lucroPorUnidade/precoVendaUnitario×100, quando o preço for maior que zero; não confundir margem com markup.',
        'QUAL CÁLCULO USAR: consumo de material/desperdício → fórmula de área. Quantas unidades cabem no plano → U=262, V até 150, floor por eixo e comparação de orientações permitidas; depois conferir corte separado das laterais. Mochila com sanfona → acrescentar 2S no comprimento do conjunto e contar 2 sanfonas por unidade. Alças/cordões → usar escala H/30. Custo/lucro → fórmulas de orçamento rápido e valores de custo/venda informados. Sobras → U − unidadesPorFileira×G e V − fileiras×alturaDaPeça.',
        'DICAS E LIMITES: se o usuário escrever “262/150”, interprete como plano de 262 cm × 150 cm quando o contexto indicar comprimento útil × largura do material. Informe orientação, capacidade dos corpos, necessidade de cortes laterais e desperdício. A lógica oficial é um cálculo retangular por fileiras/colunas, não um nesting avançado. Não invente margem de costura, bolsos, tampa, alças adicionais nem partes que não estejam nos dados. Se faltar uma variável relevante, declare a hipótese ou pergunte.',
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
      sections.push('REGRAS OFICIAIS DE MEDIÇÃO DO ANGLER ERP: consulte as fórmulas completas do prompt de sistema. O plano padrão usa 262 cm de comprimento útil (mesa de 300 cm menos 19 cm em cada lateral) e até 150 cm de largura. Calcule a capacidade por fileiras e colunas inteiras, compare as duas orientações quando não houver sanfona e calcule as laterais separadamente. A aproximação por área não é a fórmula oficial de capacidade física.');
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
