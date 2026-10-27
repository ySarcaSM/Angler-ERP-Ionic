import { ChangeDetectorRef, Component, ElementRef, inject, OnInit, ViewChild } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { ClientsService } from '../services/clients.service';
import { ProductsService } from '../services/products.service';
import { GeminiAiService } from '../core/gemini-ai.service';

interface ChatMessage { role: 'user' | 'assistant'; content: string; createdAt: number; }
interface ChatThread { id: string; title: string; messages: ChatMessage[]; updatedAt: number; }
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
  private readonly cdr = inject(ChangeDetectorRef);

  private readonly gemini = inject(GeminiAiService);
  @ViewChild('messagesContainer') private messagesContainer?: ElementRef<HTMLElement>;
  private shouldAutoScroll = true;
  chats: ChatThread[] = [];
  activeChatId = '';
  draft = '';
  loading = false;
  private readonly storageKey = 'angler-assistant-chats-v1';

  ngOnInit(): void {
    this.loadChats();
    if (!this.chats.length) this.newChat();
  }

  get activeChat(): ChatThread | undefined { return this.chats.find(chat => chat.id === this.activeChatId); }

  onMessagesScroll(): void {
    const element = this.messagesContainer?.nativeElement;
    if (!element) return;
    this.shouldAutoScroll = element.scrollHeight - element.scrollTop - element.clientHeight < 80;
  }

  private scrollMessagesToBottom(force = false): void {
    if (force) this.shouldAutoScroll = true;
    requestAnimationFrame(() => {
      const element = this.messagesContainer?.nativeElement;
      if (!element || (!force && !this.shouldAutoScroll)) return;
      element.scrollTop = element.scrollHeight;
    });
  }

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

  handleEnter(event: Event): void {
    const keyboardEvent = event as KeyboardEvent;
    if (!keyboardEvent.shiftKey) { keyboardEvent.preventDefault(); void this.send(); }
  }

  async send(): Promise<void> {
    const prompt = this.draft.trim();
    if (!prompt || this.loading) return;
    if (!this.activeChat) this.newChat();
    const chat = this.activeChat!;
    this.draft = '';
    chat.messages.push({ role: 'user', content: prompt, createdAt: Date.now() });
    if (chat.messages.length === 1 && chat.title === 'Nova conversa') chat.title = prompt.slice(0, 42) + (prompt.length > 42 ? '…' : '');
    chat.updatedAt = Date.now(); this.saveChats(); this.loading = true;
    this.scrollMessagesToBottom(true);
    let assistantMessage: ChatMessage | undefined;
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
        'Nunca revele nem repita a chave de API.',
        context
      ].join('\n\n');
      const history = chat.messages.slice(-16).map(message => ({ role: message.role, content: message.content }));
      assistantMessage = { role: 'assistant', content: '', createdAt: Date.now() };
      chat.messages.push(assistantMessage);
      this.cdr.markForCheck();
      this.scrollMessagesToBottom(true);
      await this.gemini.generate([{ role: 'system', content: system }, ...history], text => {
        assistantMessage!.content = text;
        this.cdr.markForCheck();
        this.scrollMessagesToBottom();
      });
      chat.updatedAt = Date.now(); this.saveChats();
    } catch (error) {
      const failure = `Não consegui concluir a solicitação: ${this.message(error)}`;
      if (assistantMessage) assistantMessage.content = failure;
      else chat.messages.push({ role: 'assistant', content: failure, createdAt: Date.now() });
      this.saveChats();
    } finally { this.loading = false; this.cdr.markForCheck(); this.scrollMessagesToBottom(); }
  }

  formatMessage(source: string): string {
    const escapeHtml = (value: string): string => value
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

    const inline = (value: string): string => {
      const placeholders: string[] = [];
      const hold = (html: string): string => {
        const token = '%%ANGHTML' + placeholders.length + '%%';
        placeholders.push(html);
        return token;
      };

      const readableMath = value
        .replace(/\${1,2}([\s\S]*?)\${1,2}/g, '$1')
        .replace(/\\text\{([^{}]*)\}/g, '$1')
        .replace(/\\mathrm\{([^{}]*)\}/g, '$1')
        .replace(/\\mathbf\{([^{}]*)\}/g, '**$1**')
        .replace(/\\lfloor/g, '⌊')
        .replace(/\\rfloor/g, '⌋')
        .replace(/\\times/g, '×')
        .replace(/\\cdot/g, '·')
        .replace(/\\div/g, '÷')
        .replace(/\\leq/g, '≤')
        .replace(/\\geq/g, '≥')
        .replace(/\\approx/g, '≈')
        .replace(/\\%/g, '%')
        .replace(/\\([#$&_{}])/g, '$1')
        .replace(/\\(?:,|;|quad|qquad)/g, ' ');
      let html = escapeHtml(readableMath);
      html = html.replace(/\x60([^\x60\n]+)\x60/g, (_match, code: string) => hold('<code>' + code + '</code>'));
      html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_match, label: string, href: string) => {
        const safeHref = href.replace(/&amp;/g, '&');
        if (!/^https?:\/\//i.test(safeHref) && !/^mailto:/i.test(safeHref)) return label;
        return hold('<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>');
      });
      html = html
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/__(.+?)__/g, '<strong>$1</strong>')
        .replace(/~~(.+?)~~/g, '<del>$1</del>')
        .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
        .replace(/_([^_\n]+)_/g, '<em>$1</em>');
      return html.replace(/%%ANGHTML(\d+)%%/g, (_match, index: string) => placeholders[Number(index)]);
    };

    const blocks: string[] = [];
    const lines = source.replace(/\r\n?/g, '\n').split('\n');
    let paragraph: string[] = [];
    let listType: 'ul' | 'ol' | null = null;
    let quoteLines: string[] = [];
    let codeLines: string[] | null = null;

    const flushParagraph = (): void => {
      if (!paragraph.length) return;
      blocks.push('<p>' + paragraph.join('<br>') + '</p>');
      paragraph = [];
    };
    const closeList = (): void => {
      if (!listType) return;
      blocks.push('</' + listType + '>');
      listType = null;
    };
    const flushQuote = (): void => {
      if (!quoteLines.length) return;
      blocks.push('<blockquote>' + quoteLines.map(inline).join('<br>') + '</blockquote>');
      quoteLines = [];
    };

    for (const line of lines) {
      if (codeLines) {
        if (/^\s*\x60\x60\x60/.test(line)) {
          blocks.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
          codeLines = null;
        } else {
          codeLines.push(line);
        }
        continue;
      }
      if (/^\s*\x60\x60\x60/.test(line)) {
        flushParagraph();
        closeList();
        flushQuote();
        codeLines = [];
        continue;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        flushQuote();
        continue;
      }

      const heading = line.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        flushParagraph(); closeList(); flushQuote();
        const level = heading[1].length;
        blocks.push('<h' + level + '>' + inline(heading[2]) + '</h' + level + '>');
        continue;
      }
      if (/^\s*(\*\s*){3,}$|^\s*(-\s*){3,}$|^\s*(_\s*){3,}$/.test(line)) {
        flushParagraph(); closeList(); flushQuote();
        blocks.push('<hr>');
        continue;
      }

      const unordered = line.match(/^\s*[-*+]\s+(.+)$/);
      const ordered = line.match(/^\s*\d+[.)]\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph(); flushQuote();
        const nextType = unordered ? 'ul' : 'ol';
        if (listType !== nextType) {
          closeList();
          listType = nextType;
          blocks.push('<' + listType + '>');
        }
        const item = unordered ?? ordered;
        blocks.push('<li>' + inline(item![1]) + '</li>');
        continue;
      }

      const quote = line.match(/^\s*>\s?(.*)$/);
      if (quote) {
        flushParagraph(); closeList();
        quoteLines.push(quote[1]);
        continue;
      }

      closeList();
      flushQuote();
      paragraph.push(inline(line));
    }

    flushParagraph();
    closeList();
    flushQuote();
    if (codeLines) blocks.push('<pre><code>' + escapeHtml(codeLines.join('\n')) + '</code></pre>');
    return blocks.join('');
  }

  private async buildBusinessContext(prompt: string): Promise<string> {
    const lower = prompt.toLocaleLowerCase('pt-BR');
    const wantsClients = /cliente|clientes|contato|contatos|comprador/.test(lower);
    const wantsProducts = /produto|produtos|estoque|preço|precos|venda|vendas|melhor|relatório|relatorio|mochila/.test(lower);
    const wantsCalculation = /quant|calcule|calcular|cálculo|calculo|medida|medidas|plano|área|area|quanto|porcentagem|margem/.test(lower);

    const [clients, products] = await Promise.all([
      wantsClients
        ? this.clientsService.list().then(value => ({ value })).catch(error => ({ error: this.message(error) }))
        : Promise.resolve(null),
      wantsProducts
        ? this.productsService.list().then(value => ({ value })).catch(error => ({ error: this.message(error) }))
        : Promise.resolve(null)
    ]);

    const sections: string[] = [];
    if (clients && 'value' in clients) {
      sections.push('CLIENTES DISPONÍVEIS PARA ESTA SESSÃO:\n' + JSON.stringify(clients.value.map(c => ({
        nome: c.name, documento: c.document, email: c.email, telefone: c.phone, contato: c.contact, endereço: c.address, ativo: c.active
      }))));
    } else if (clients && 'error' in clients) {
      sections.push('CLIENTES: não foi possível ler o módulo com as permissões atuais (' + clients.error + ').');
    }

    if (products && 'value' in products) {
      sections.push('PRODUTOS DISPONÍVEIS PARA ESTA SESSÃO:\n' + JSON.stringify(products.value.map(p => ({
        nome: p.name, descrição: p.description, custo: p.costPrice, preçoVenda: p.sellPrice,
        estoqueAtual: p.stock?.current, estoqueMínimo: p.stock?.minimum, estoqueMáximo: p.stock?.maximum,
        localização: p.stock?.location, ativo: p.active
      }))));
    } else if (products && 'error' in products) {
      sections.push('PRODUTOS: não foi possível ler o módulo com as permissões atuais (' + products.error + ').');
    }

    if (wantsCalculation) {
      sections.push('REGRAS OFICIAIS DE MEDIÇÃO DO ANGLER ERP: consulte as fórmulas completas do prompt de sistema. O plano padrão usa 262 cm de comprimento útil (mesa de 300 cm menos 19 cm em cada lateral) e até 150 cm de largura. Calcule a capacidade por fileiras e colunas inteiras, compare as duas orientações quando não houver sanfona e calcule as laterais separadamente. A aproximação por área não é a fórmula oficial de capacidade física.');
    }
    return sections.length
      ? 'CONTEXTO DO ERP (dados atuais consultados na sessão):\n' + sections.join('\n\n')
      : 'Nenhum dado do ERP foi solicitado explicitamente. Se a pergunta depender de clientes/produtos, consulte os serviços correspondentes quando pertinente.';
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
    try { localStorage.setItem(this.storageKey, JSON.stringify(this.chats)); } catch { console.warn('Não foi possível salvar as conversas neste navegador.'); }
  }
  private makeId(): string { return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`; }
  private message(error: unknown): string { return error instanceof Error ? error.message : 'Erro desconhecido.'; }
}
